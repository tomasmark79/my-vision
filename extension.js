/* 
Copyright (C) 2024 Christophe Van den Abbeele, Tomáš Mark

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { DisplayConfigSwitcher } from './dbus.js';
import { NameDialog } from './dialog.js';
import { ConfigIndex, updateConfigHash, comparePhysicalDisplays, compareConfigsByPhysicalProperties } from './config.js'



const DisplayConfigQuickMenuToggle = GObject.registerClass(
    class DisplayConfigQuickMenuToggle extends QuickSettings.QuickMenuToggle {

        _init(extension) {
            // Set QuickMenu name and icon
            super._init({
                title: 'Displays',
                iconName: 'video-display-symbolic',
                toggleMode: false,
            });

            this.menu.setHeader('video-display-symbolic', 'Display Configuration');

            this._extension = extension;
            this._settings = this._extension.getSettings();
            this._lastConfigIndex = this._settings.get_uint('last-config-index');
            this._lastConfigLoaded = false;
            this._configsChangedHandler = this._settings.connect('changed::configs', () => {
                this._onConfigsChanged();
            });

            this._displayConfigSwitcher = new DisplayConfigSwitcher(() => {
                this._updateMenu();
            });
            this._nameDialog = new NameDialog();
            this._dialogHandlerId = null;
            this._configs = [];
            this._currentConfigs = [];
            this._applyingConfig = false;
            this._isApplyingConfig = false;  // Mutex to prevent concurrent config applications
            this._isSaving = false;  // Flag to prevent recursion in _saveConfigs

            this.connect('clicked', () => this._onClicked());

            this._onConfigsChanged();

            this._settings.connect('changed::display-configuration-switcher-shortcuts-enabled', (settings, key) => {
                this._updateKeyBindings();
            });

            this._updateKeyBindings();
        }

        _updateKeyBindings() {
            if (this._settings.get_boolean('display-configuration-switcher-shortcuts-enabled')) {
                this._addKeyBinding('display-configuration-switcher-shortcut-next', async () => {
                    await this._cycleConfig(true);
                });
                this._addKeyBinding('display-configuration-switcher-shortcut-previous', async () => {
                    await this._cycleConfig(false);
                });
            } else {
                Main.wm.removeKeybinding('display-configuration-switcher-shortcut-next');
                Main.wm.removeKeybinding('display-configuration-switcher-shortcut-previous');
            }
        }

        _addKeyBinding(key, handler) {
            Main.wm.addKeybinding(
                key,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                handler
            );
        }

        destroy() {
            // Critical: disconnect all signals and clear timeouts first to prevent callbacks on destroyed objects
            this._displayConfigSwitcher.destroy();
            this._displayConfigSwitcher = null;

            if (this._configsChangedHandler) {
                this._settings.disconnect(this._configsChangedHandler);
                this._configsChangedHandler = null;
            }

            // Fix memory leak - disconnect dialog handler if still connected
            if (this._dialogHandlerId) {
                this._nameDialog.disconnect(this._dialogHandlerId);
                this._dialogHandlerId = null;
            }

            this._nameDialog.destroy();

            Main.wm.removeKeybinding('display-configuration-switcher-shortcut-next');
            Main.wm.removeKeybinding('display-configuration-switcher-shortcut-previous');

            super.destroy();
        }

        _onConfigsChanged() {
            this._configs = this._settings.get_value('configs').deepUnpack();
            for (let config of this._configs) {
                updateConfigHash(config)
            }

            this._updateMenu();
        }

        _addDummyItem(message) {
            const item = new PopupMenu.PopupMenuItem(message);
            item.label.get_clutter_text().set_line_wrap(true);
            this.menu.addMenuItem(item);
        }

        _updateMenu() {
            // log('MY-VISION: _updateMenu called');
            this.menu.removeAll();

            this._filterConfigs();
            this._loadDefaultIfNeeded();
            if (!this._addConfigItems()) { return; }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._addModifyItems();
        }

        _filterConfigs() {
            const activeDisplays = this._displayConfigSwitcher.getPhysicalDisplayInfo();

            if (activeDisplays === null) { return; }

            this._currentConfigs = [];
            for (let config of this._configs) {
                const displays = config[ConfigIndex.PHYSICAL_DISPLAYS];
                // Match based on displayName (new format) or vendor/product/serial (old format)
                // rather than connector name, to handle connector swaps
                if (displays.every(display =>
                    activeDisplays.some(activeDisplay => {
                        const activeDisplayArray = [activeDisplay.id[0], activeDisplay.displayName];
                        return comparePhysicalDisplays(display, activeDisplayArray);
                    })
                )) {
                    this._currentConfigs.push(config);
                }
            };
        }

        _loadDefaultIfNeeded() {
            if (this._displayConfigSwitcher.hasState() && !this._lastConfigLoaded && this._currentConfigs.length > 0) {
                this._lastConfigLoaded = true;
                const lastConfig = this._configs.length > this._lastConfigIndex ? this._configs[this._lastConfigIndex] : null;
                if (lastConfig !== null && (this._currentConfigs.indexOf(lastConfig) > -1)) {
                    this._onConfig(lastConfig).catch(err => {
                        console.error('Failed to load default monitor configuration:', err);
                        Main.notify('Display Configuration Error', `Failed to load default configuration: ${err.message}`);
                    });
                }
            }
        }

        _addConfigItems() {
            this.subtitle = null;
            this.checked = false;
            this._activeConfig = null;

            if (this._configs.length === 0) {
                this._addDummyItem("No configurations saved for this display setup.");
                return true;
            }

            const currentConfig = this._displayConfigSwitcher.getMonitorsConfig();

            if (currentConfig === null) { return true; }

            let currentConfigFound = false;

            for (let config of this._currentConfigs) {
                const configItem = new PopupMenu.PopupMenuItem(config[ConfigIndex.NAME]);

                configItem.connect('activate', () => {
                    // console.log(`Clicked on config: ${config[ConfigIndex.NAME]}`);
                    this._onConfig(config).catch(err => {
                        console.error('Failed to apply monitor configuration:', err);
                        Main.notify('Display Configuration Error', `Failed to apply "${config[ConfigIndex.NAME]}": ${err.message}`);
                    });
                });

                // console.log(`\n=== Checking config: ${config[ConfigIndex.NAME]} ===`);
                // console.log(`Saved hash: ${config[ConfigIndex.HASH]}`);
                // console.log(`Current hash: ${currentConfig[ConfigIndex.HASH]}`);

                // First try hash comparison (fastest)
                let isMatch = config[ConfigIndex.HASH] === currentConfig[ConfigIndex.HASH];

                // Secondary check to prevent hash collisions: verify physical displays match
                if (isMatch) {
                    const physicalMatch = compareConfigsByPhysicalProperties(config, currentConfig);
                    if (!physicalMatch) {
                        console.warn(`WARNING: Hash collision detected! Hashes match but physical displays differ.`);
                        isMatch = false;
                    }
                }

                // console.log(`Direct hash match: ${isMatch}`);

                // If hash doesn't match, try remapped comparison
                // (handles connector swaps where physical displays are same but connectors changed)
                if (!isMatch) {
                    const remappedLogicalMonitors = this._displayConfigSwitcher.remapConnectorsInConfig(
                        config[ConfigIndex.LOGICAL_MONITORS],
                        config[ConfigIndex.PHYSICAL_DISPLAYS]
                    );

                    // Create temporary config with remapped data for hash comparison
                    const tempConfig = [...config];
                    tempConfig[ConfigIndex.LOGICAL_MONITORS] = remappedLogicalMonitors;
                    tempConfig[ConfigIndex.PHYSICAL_DISPLAYS] = this._displayConfigSwitcher.getPhysicalDisplayInfo().map(v => [
                        v.id[0],
                        v.displayName
                    ]);
                    updateConfigHash(tempConfig);

                    // console.log(`Remapped hash: ${tempConfig[ConfigIndex.HASH]}`);

                    isMatch = tempConfig[ConfigIndex.HASH] === currentConfig[ConfigIndex.HASH];
                    // console.log(`Remapped hash match: ${isMatch}`);
                }

                if (isMatch) {
                    // console.log(`✓ Setting checkmark for: ${config[ConfigIndex.NAME]}`);
                    configItem.setOrnament(PopupMenu.Ornament.CHECK);
                    this.subtitle = config[ConfigIndex.NAME];
                    this.checked = true;
                    this._activeConfig = config;
                    this._saveLastConfigIndex(this._configs.indexOf(config));
                    currentConfigFound = true;
                }

                this.menu.addMenuItem(configItem);
            }

            // If no match was found, it could be because of the added color-mode property in GNOME 48
            if (!currentConfigFound) {
                // Remove color-mode property from current config
                for (let logicalMonitor of currentConfig[ConfigIndex.LOGICAL_MONITORS]) {
                    for (let monitor of logicalMonitor[5]) {
                        let monitorProps = monitor[2];
                        if (monitorProps !== undefined) {
                            delete monitorProps["color-mode"];
                        }
                    }
                }
                // Calculate hash again
                updateConfigHash(currentConfig);
                const oldHash = currentConfig[ConfigIndex.HASH];

                // See if we find a match now
                for (const [index, config] of this._configs.entries()) {
                    if (config[ConfigIndex.HASH] === oldHash) {
                        // If a match is found, save the new version of the config (with color-mode parameter)
                        const name = this._configs[index][ConfigIndex.NAME];
                        this._configs[index] = this._displayConfigSwitcher.getMonitorsConfig();
                        this._configs[index][ConfigIndex.NAME] = name; // Name gets overwritten to "" so put it back
                        this._saveConfigs(); // TODO maybe fix this recursion (visible when doing upgrade)
                        return false;
                    }
                }
            }
            return true;
        }

        _addModifyItems() {
            if (this._activeConfig === null) {
                const addConfigItem = new PopupMenu.PopupImageMenuItem(_("Add Configuration"), 'list-add-symbolic');
                addConfigItem.connect('activate', () => {
                    this._onAddConfig();
                });
                this.menu.addMenuItem(addConfigItem);
            }

            const preferencesItem = new PopupMenu.PopupImageMenuItem(_("Modify Configurations"), 'document-edit-symbolic');
            preferencesItem.connect('activate', () => {
                this._extension.openPreferences();
            });
            this.menu.addMenuItem(preferencesItem);
        }

        _saveConfigs() {
            // Prevent recursion (can happen during config upgrade)
            if (this._isSaving) {
                // console.log('Already saving configs, preventing recursion');
                return;
            }

            this._isSaving = true;
            try {
                const configsVariant = new GLib.Variant('a(sua(iiduba(ssa{sv}))a{sv}a(ss))', this._configs);
                this._settings.set_value('configs', configsVariant);
            } finally {
                this._isSaving = false;
            }
        }

        _saveLastConfigIndex(i) {
            this._settings.set_uint('last-config-index', i);
        }

        async _onClicked() {
            await this._cycleConfig(true);
        }
        async _cycleConfig(forward) {
            const nConfigs = this._currentConfigs.length;
            if (nConfigs === 0) {
                return;
            }

            if (this._activeConfig === null) {
                try {
                    await this._onConfig(this._currentConfigs[0]);
                } catch (error) {
                    console.error('Failed to apply first monitor configuration:', error);
                    Main.notify('Display Configuration Error', `Failed to apply configuration: ${error.message}`);
                }
                return;
            }

            const currentIndex = this._currentConfigs.indexOf(this._activeConfig);
            let newIndex;

            if (forward) {
                newIndex = currentIndex === (nConfigs - 1) ? 0 : currentIndex + 1;
            } else {
                newIndex = currentIndex === 0 ? nConfigs - 1 : currentIndex - 1;
            }

            try {
                await this._onConfig(this._currentConfigs[newIndex]);
            } catch (error) {
                console.error('Failed to cycle monitor configuration:', error);
                Main.notify('Display Configuration Error', `Failed to switch configuration: ${error.message}`);
            }
        }

        async _onConfig(config) {
            // Mutex: prevent concurrent config applications
            if (this._isApplyingConfig) {
                // console.log(`Already applying a config, ignoring request for: ${config[ConfigIndex.NAME]}`);
                return;
            }

            // console.log(`_onConfig called for: ${config[ConfigIndex.NAME]}`);
            this._isApplyingConfig = true;

            try {
                // Remap connector names to handle connector swaps
                const remappedLogicalMonitors = this._displayConfigSwitcher.remapConnectorsInConfig(
                    config[ConfigIndex.LOGICAL_MONITORS],
                    config[ConfigIndex.PHYSICAL_DISPLAYS]
                );
                // console.log(`Remapped config, applying...`);
                await this._displayConfigSwitcher.applyMonitorsConfig(remappedLogicalMonitors, config[ConfigIndex.PROPERTIES]);
                // console.log(`Config applied successfully`);
            } catch (error) {
                console.error('Error applying monitor configuration:', error);
            } finally {
                this._isApplyingConfig = false;
            }
        }

        _onAddConfig() {
            this._nameDialog.setMessage(_("Enter a name for the current configuration."));
            this._nameDialog.setName("");
            this._dialogHandlerId = this._nameDialog.connect('closed', () => {
                this._onNameDialogClosed();
            });
            this._nameDialog.open();
        }

        _onNameDialogClosed() {
            if (this._dialogHandlerId) {
                this._nameDialog.disconnect(this._dialogHandlerId);
                this._dialogHandlerId = null;
            }

            if (!this._nameDialog.isValid()) {
                return;
            }

            let currentConfig = this._displayConfigSwitcher.getMonitorsConfig();
            const newName = this._nameDialog.getName();
            currentConfig[ConfigIndex.NAME] = newName;

            // Check if a configuration with the same physical properties already exists
            let existingConfigIndex = -1;
            for (let i = 0; i < this._configs.length; i++) {
                if (compareConfigsByPhysicalProperties(this._configs[i], currentConfig)) {
                    existingConfigIndex = i;
                    break;
                }
            }

            if (existingConfigIndex >= 0) {
                // Update existing config instead of creating a new one
                this._configs[existingConfigIndex] = currentConfig;
            } else {
                // Add as new config
                this._configs.push(currentConfig);
            }

            this._saveConfigs();
            this._updateMenu();
        }
    });

export default class MyVisionExtension extends Extension {
    enable() {
        this._indicator = new QuickSettings.SystemIndicator();
        this._indicator.quickSettingsItems.push(new DisplayConfigQuickMenuToggle(this));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}

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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {DisplayConfigSwitcher, isCancelled} from './dbus.js';
import {NameDialog} from './dialog.js';
import {ProfileStore, activeProfile, contextKey, displayRecord, profileLabel, profileRequest, selectProfile} from './profiles.js';

const DisplayConfigQuickMenuToggle = GObject.registerClass(
    class DisplayConfigQuickMenuToggle extends QuickSettings.QuickMenuToggle {
        _init(extension) {
            super._init({title: 'Displays', iconName: 'video-display-symbolic', toggleMode: false});
            this.menu.setHeader('video-display-symbolic', 'Display Configuration');
            this._extension = extension;
            this._settings = extension.getSettings();
            this._store = new ProfileStore(this._settings);
            this._cancellable = new Gio.Cancellable();
            this._isApplyingConfig = false;
            this._context = null;
            this._handledContext = false;
            this._retryCount = 0;
            this._pendingProfile = null;
            this._pendingOsd = null;
            this._currentConfigs = [];
            this._activeConfig = null;
            this._nameDialog = new NameDialog();
            this._dialogHandlerId = null;
            this._displayConfigSwitcher = new DisplayConfigSwitcher(() => this._onStateChanged());
            this._configsChangedHandler = this._settings.connect('changed::profiles-v2', () => {
                this._store.reload();
                this._updateMenu();
            });
            this._shortcutsEnabledHandler = this._settings.connect('changed::display-configuration-switcher-shortcuts-enabled', () => this._updateKeyBindings());
            this.connect('clicked', () => this._cycleConfig(true));
            this._updateKeyBindings();
        }

        _updateKeyBindings() {
            for (const [key, forward] of [['display-configuration-switcher-shortcut-next', true], ['display-configuration-switcher-shortcut-previous', false]]) {
                Main.wm.removeKeybinding(key);
                if (this._settings.get_boolean('display-configuration-switcher-shortcuts-enabled'))
                    Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.NONE,
                        Shell.ActionMode.NORMAL, () => this._cycleConfig(forward));
            }
        }

        _getContext() {
            const displays = this._displayConfigSwitcher.getPhysicalDisplayInfo();
            const lid = this._displayConfigSwitcher.getLidState();
            return displays === null || lid === 'unknown' ? null : contextKey(displays.map(displayRecord), lid);
        }

        _onStateChanged() {
            const key = this._getContext();
            if (key !== this._context) {
                this._context = key;
                this._handledContext = false;
                this._retryCount = 0;
            }
            this._store.enrich(this._displayConfigSwitcher.getPhysicalDisplayInfo() ?? []);
            this._updateMenu();
            this._showPendingOsd();
            if (key === null || this._isApplyingConfig || this._handledContext || this._currentConfigs.length === 0)
                return;
            const profile = selectProfile(this._currentConfigs, this._store.last[key],
                this._store.legacyId, this._displayConfigSwitcher.getLidState(), p => this._isActive(p));
            this._onConfig(profile, true);
        }

        _showPendingOsd() {
            if (this._isApplyingConfig || this._pendingOsd === null)
                return;
            const pending = this._pendingOsd;
            this._pendingOsd = null;
            const profile = this._store.profiles.find(p => p.id === pending.id);
            if (pending.context !== this._getContext() || !profile || !this._isActive(profile))
                return;

            // A confirmed profile describes every active logical monitor, so all
            // current OSD windows correspond to displays enabled by that profile.
            const icon = new Gio.ThemedIcon({name: 'video-display-symbolic'});
            // GNOME 49 introduced showAll(); 46–48 use show() with index -1.
            if (Number.parseInt(Config.PACKAGE_VERSION, 10) >= 49)
                Main.osdWindowManager.showAll(icon, profile.config[0], null);
            else
                Main.osdWindowManager.show(-1, icon, profile.config[0], null);
        }

        _isActive(profile) {
            return activeProfile(profile, this._displayConfigSwitcher.getPhysicalDisplayInfo() ?? [],
                this._displayConfigSwitcher.getLidState(), this._displayConfigSwitcher.getMonitorsConfig());
        }

        _updateMenu() {
            this.menu.removeAll();
            this.subtitle = null;
            this.checked = false;
            this._activeConfig = null;
            const displays = this._displayConfigSwitcher.getPhysicalDisplayInfo() ?? [];
            const lid = this._displayConfigSwitcher.getLidState();
            this._currentConfigs = this._store.profiles.filter(profile => {
                try { profileRequest(profile, displays, lid); return true; } catch { return false; }
            });
            const active = this._currentConfigs.filter(p => this._isActive(p));
            this._activeConfig = active.find(p => p.id === this._store.last[this._getContext()]) ??
                active.find(p => p.lid === lid) ?? active[0] ?? null;
            for (const profile of this._currentConfigs) {
                const item = new PopupMenu.PopupMenuItem(profileLabel(profile));
                item.connect('activate', () => this._onConfig(profile));
                if (profile === this._activeConfig) {
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                    this.subtitle = profile.config[0];
                    this.checked = true;
                }
                this.menu.addMenuItem(item);
            }
            if (!this._currentConfigs.length) {
                const item = new PopupMenu.PopupMenuItem(lid === 'unknown'
                    ? 'Waiting for laptop lid information…' : 'No profiles available for this setup. Save the current configuration.');
                item.setSensitive(false);
                item.label.get_clutter_text().set_line_wrap(true);
                this.menu.addMenuItem(item);
            }
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            // Saving remains available when a legacy/shared profile matches: a
            // separate lid-specific profile is a valid new configuration.
            const add = new PopupMenu.PopupImageMenuItem(_('Save Current Configuration'), 'list-add-symbolic');
            add.setSensitive(this._getContext() !== null && !this._isApplyingConfig);
            add.connect('activate', () => this._onAddConfig());
            this.menu.addMenuItem(add);
            const prefs = new PopupMenu.PopupImageMenuItem(_('Modify Configurations'), 'document-edit-symbolic');
            prefs.connect('activate', () => this._extension.openPreferences());
            this.menu.addMenuItem(prefs);
        }

        _cycleConfig(forward) {
            const count = this._currentConfigs.length;
            if (!count)
                return;
            const index = this._currentConfigs.findIndex(p => p.id === this._activeConfig?.id);
            this._onConfig(this._currentConfigs[index < 0 ? 0 : (index + (forward ? 1 : -1) + count) % count]);
        }

        async _onConfig(profile, automatic = false) {
            if (!profile)
                return;
            if (this._isApplyingConfig) {
                if (!automatic)
                    this._pendingProfile = {id: profile.id, context: this._getContext()};
                return;
            }
            const key = this._getContext();
            if (key === null)
                return;
            const cancellable = this._cancellable;
            this._pendingOsd = null;
            this._handledContext = true;
            this._isApplyingConfig = true;
            try {
                await this._displayConfigSwitcher.applyProfile(profile);
                cancellable.set_error_if_cancelled();
                if (this._getContext() === key &&
                    this._store.profiles.some(p => p.id === profile.id)) {
                    this._store.remember(key, profile.id);
                    if (this._pendingProfile === null)
                        this._pendingOsd = {id: profile.id, context: key};
                }
            } catch (error) {
                if (!cancellable.is_cancelled() && !isCancelled(error)) {
                    // A changed lid/topology supersedes the old request. The next
                    // state callback will restore the new context exactly once.
                    if (this._getContext() !== key)
                        this._handledContext = false;
                    else if (automatic && error.code === 'STATE_CHANGED' && this._retryCount++ < 2)
                        this._handledContext = false;
                    else {
                        console.warn(`Failed to apply display profile: ${error.message}`);
                        Main.notify('Display Configuration', `${automatic ? 'Could not restore' : 'Could not apply'} “${profile.config[0]}”: ${error.message}`);
                    }
                }
            } finally {
                if (!cancellable.is_cancelled()) {
                    this._isApplyingConfig = false;
                    if (this._pendingProfile) {
                        const pending = this._pendingProfile;
                        this._pendingProfile = null;
                        if (pending.context === this._getContext())
                            this._onConfig(this._store.profiles.find(p => p.id === pending.id));
                    }
                }
                // The switcher publishes a debounced fresh state after Apply.
            }
        }

        _onAddConfig() {
            if (this._dialogHandlerId !== null)
                return;
            this._dialogContext = this._getContext();
            this._nameDialog.setMessage(_('Enter a name for the current configuration.') +
                `\n${this._displayConfigSwitcher.getLidState() === 'closed' ? 'Lid closed' : this._displayConfigSwitcher.getLidState() === 'open' ? 'Lid open' : 'Any lid state'}`);
            this._nameDialog.setName('');
            this._dialogHandlerId = this._nameDialog.connect('closed', () => this._onNameDialogClosed());
            this._nameDialog.open();
        }

        async _onNameDialogClosed() {
            this._nameDialog.disconnect(this._dialogHandlerId);
            this._dialogHandlerId = null;
            if (!this._nameDialog.isValid())
                return;
            const name = this._nameDialog.getName().trim();
            const expectedContext = this._dialogContext;
            const cancellable = this._cancellable;
            try {
                if (this._isApplyingConfig)
                    throw new Error('Displays are changing. Please save the configuration again.');
                const refreshed = await this._displayConfigSwitcher.refresh();
                cancellable.set_error_if_cancelled();
                if (!refreshed)
                    throw new Error('Displays are changing. Please save the configuration again.');
                const key = this._getContext();
                if (key === null || key !== expectedContext)
                    throw new Error('The lid or connected monitors changed. Please save the configuration again.');
                this._store.reload();
                this._store.enrich(this._displayConfigSwitcher.getPhysicalDisplayInfo());
                const config = this._displayConfigSwitcher.getMonitorsConfig();
                config[0] = name;
                const profile = {id: GLib.uuid_string_random(), lid: this._displayConfigSwitcher.getLidState(), config,
                    displays: this._displayConfigSwitcher.getPhysicalDisplayInfo().map(displayRecord)};
                profileRequest(profile, this._displayConfigSwitcher.getPhysicalDisplayInfo(), profile.lid);
                const saved = this._store.add(profile);
                this._handledContext = true;
                this._store.remember(key, saved.id);
                this._updateMenu();
                if (saved.id !== profile.id)
                    Main.notify('Display Configuration', `This configuration is already saved as “${saved.config[0]}”.`);
            } catch (error) {
                if (!cancellable.is_cancelled() && !isCancelled(error))
                    Main.notify('Display Configuration', error.message);
            }
        }

        destroy() {
            this._settings.disconnect(this._configsChangedHandler);
            this._configsChangedHandler = null;
            this._settings.disconnect(this._shortcutsEnabledHandler);
            this._shortcutsEnabledHandler = null;
            if (this._dialogHandlerId !== null) {
                this._nameDialog.disconnect(this._dialogHandlerId);
                this._dialogHandlerId = null;
            }
            Main.wm.removeKeybinding('display-configuration-switcher-shortcut-next');
            Main.wm.removeKeybinding('display-configuration-switcher-shortcut-previous');
            this._cancellable.cancel();
            this._cancellable = null;
            this._displayConfigSwitcher.destroy();
            this._displayConfigSwitcher = null;
            this._nameDialog.destroy();
            this._nameDialog = null;
            this._pendingProfile = null;
            this._pendingOsd = null;
            this._currentConfigs = [];
            this._activeConfig = null;
            this._store = null;
            this._settings = null;
            this._extension = null;
            super.destroy();
        }

    });

export default class MyVisionExtension extends Extension {
    enable() {
        this._indicator = null;
        this._startupHandlerId = null;
        if (Main.layoutManager._startingUp) {
            this._startupHandlerId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupHandlerId);
                this._startupHandlerId = null;
                this._createIndicator();
            });
        } else {
            this._createIndicator();
        }
    }

    disable() {
        if (this._startupHandlerId !== null) {
            Main.layoutManager.disconnect(this._startupHandlerId);
            this._startupHandlerId = null;
        }
        if (this._indicator === null)
            return;
        for (const item of this._indicator.quickSettingsItems.splice(0))
            item.destroy();
        this._indicator.destroy();
        this._indicator = null;
    }
    _createIndicator() {
        this._indicator = new QuickSettings.SystemIndicator();
        this._indicator.quickSettingsItems.push(new DisplayConfigQuickMenuToggle(this));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }


}

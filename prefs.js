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

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PrefsWidgets } from './prefs_widgets.js';
import { ProfileStore, LID_STATES } from './profiles.js';
import { DisplayConfigSwitcher, isCancelled } from './dbus.js';
import { profileStatus, formatProfileDetails } from './profile-details.js';
import { exportProfiles, mergeProfiles } from './profile-backup.js';
import { readProfileBackup, writeProfileBackup } from './profile-files.js';

const NAME_INDEX = 0;

export default class MyVisionPreferences extends ExtensionPreferences {
    /**
     * Gtk.Builder object associated with the extension
     * 
     * @type {?Gtk.Builder}
     */
    #builder = null;

    /**
     * List of saved display configurations
     *
     * @type {Array}
     */
    #configs = [];
    #store = null;
    #changedHandler = null;
    #displayConfigSwitcher = null;
    #profileRows = new Map();
    #fileCancellable = null;

    /**
     * Root widget of the preferences window
     *
     * @type {?Gtk.Root}
     */
    #root = null;

    /**
     * Gio.Settings object associated with the extension
     *
     * @type {?Settings}
     */
    #settings = null;

    fillPreferencesWindow(window) {
        this.#settings = this.getSettings();
        this.#store = new ProfileStore(this.#settings);
        this.#root = window.get_root();

        // Register resources
        const resourcePath = GLib.build_filenamev([this.path, 'resources.gresource']);
        const resource = Gio.Resource.load(resourcePath);
        Gio.resources_register(resource);

        // Initialize preferences widgets
        PrefsWidgets.initialize();

        // Load builder instance
        this.#builder = new Gtk.Builder();
        this.#builder.add_from_resource(
            `/org/gnome/Shell/Extensions/my-vision/ui/preferences_pages.ui`
        );

        // Add the Config Page
        const configPage = this.#builder.get_object('configPage');
        window.add(configPage);
        this.#builder.get_object('exportProfilesButton').connect('clicked', () => this.#transferProfiles(false));
        this.#builder.get_object('importProfilesButton').connect('clicked', () => this.#transferProfiles(true));

        // Add the Shortcut Page
        const shortcutPage = this.#builder.get_object('shortcutPage');
        window.add(shortcutPage);

        // Create the Shortcut Page
        const shortcutListBox = this.#builder.get_object('shortcutListBox');
        const shortcutRowNext = PrefsWidgets.createShortcutRow(
            _('Switch to next available display configuration'),
            'display-configuration-switcher-shortcut-next',
            this.getSettings()
        );
        shortcutListBox.append(shortcutRowNext);
        const shortcutRowPrevious = PrefsWidgets.createShortcutRow(
            _('Switch to previous available display configuration'),
            'display-configuration-switcher-shortcut-previous',
            this.getSettings()
        )
        shortcutListBox.append(shortcutRowPrevious);
        const shortcutSwitch = this.#builder.get_object('shortcutSwitch');
        this.getSettings().bind(
            'display-configuration-switcher-shortcuts-enabled',
            shortcutSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        shortcutSwitch.bind_property(
            'active',
            shortcutRowNext,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE
        )
        shortcutSwitch.bind_property(
            'active',
            shortcutRowPrevious,
            'sensitive',
            GObject.BindingFlags.SYNC_CREATE
        )

        // Drag and Drop: Drop Handling
        const dropTarget = Gtk.DropTarget.new(GObject.TYPE_INT, Gdk.DragAction.MOVE);
        const configListBox = this.#builder.get_object('configListbox');
        configListBox.add_controller(dropTarget);

        dropTarget.connect("drop", (_drop, value, _x, y) => {
            const targetRow = configListBox.get_row_at_y(y);
            if (!targetRow || value > this.#configs.length - 1) {
                return false;
            }
            const targetIndex = targetRow.get_index();
            const sourceIndex = value;

            const sourceConfig = this.#configs.splice(sourceIndex, 1)[0];

            this.#configs.splice(targetIndex, 0, sourceConfig);

            this.#saveConfigs();

            return true;
        })

        // Connect handler for changed configs
        this.#changedHandler = this.#settings.connect('changed::profiles-v2', () => {
            this.#onConfigsChanged();
        });

        // Call handler for initial fill of config list
        this.#onConfigsChanged();
        // Preferences observe monitors and lid state; they never apply a profile.
        this.#displayConfigSwitcher = new DisplayConfigSwitcher(() => this.#updateProfileDetails());

        // Handle the close-request signal to drop all references
        window.connect('close-request', () => {
            this.#fileCancellable?.cancel();
            this.#fileCancellable = null;
            this.#displayConfigSwitcher.destroy();
            this.#displayConfigSwitcher = null;
            this.#profileRows.clear();
            this.#settings.disconnect(this.#changedHandler);
            Gio.resources_unregister(resource);
            this.#store = null;
            this.#builder = null;
            this.#configs = null;
            this.#root = null;
            this.#settings = null;

            PrefsWidgets.clear();
        });
    }

    #onConfigsChanged() {
        this.#store.reload();
        this.#configs = this.#store.profiles;

        this.#updateConfigGroup();
    }

    #saveConfigs() {
        this.#store.profiles = this.#configs;
        this.#store.save();
    }

    #updateConfigGroup() {
        const configListBox = this.#builder.get_object('configListbox');
        this.#profileRows.clear();
        for (let row; (row = configListBox.get_last_child()) !== null;) {
            configListBox.remove(row);
        }

        for (const [index, profile] of this.#configs.entries()) {
            const config = profile.config;
            const row = PrefsWidgets.createConfigRow({});

            row.use_markup = false;
            row.text = config[NAME_INDEX];
            this.#profileRows.set(profile.id, row);

            const lid = new Gtk.DropDown({
                model: Gtk.StringList.new([_('Any lid state'), _('Lid open'), _('Lid closed')]),
                selected: LID_STATES.indexOf(profile.lid),
                valign: Gtk.Align.CENTER,
                tooltip_text: _('When this profile is available'),
            });
            row.add_suffix(lid);
            lid.connect('notify::selected', () => {
                const selected = LID_STATES[lid.selected];
                if (selected === profile.lid)
                    return;
                if (!this.#store.setLid(profile.id, selected)) {
                    lid.selected = LID_STATES.indexOf(profile.lid);
                    windowToast(this.#root, _('An identical profile already exists for that lid state.'));
                }
            });
            row.connect('apply', () => {
                const current = this.#store.profiles.find(p => p.id === profile.id);
                if (current && row.text.trim()) {
                    current.config[NAME_INDEX] = row.text.trim();
                    this.#store.save();
                }
            });
            row.connect('remove-clicked', () => this.#store.remove(profile.id));

            row.setupDragAndDrop(configListBox, index);

            configListBox.append(row);
        }
        this.#updateProfileDetails();
    }

    #updateProfileDetails() {
        const displays = this.#displayConfigSwitcher?.getPhysicalDisplayInfo() ?? null;
        const lid = this.#displayConfigSwitcher?.getLidState() ?? 'unknown';
        for (const profile of this.#configs) {
            const row = this.#profileRows.get(profile.id);
            const status = profileStatus(profile, displays, lid);
            row.title = status.available ? _('Available for the current setup') : `${_('Unavailable')}: ${status.reason}`;
            row.tooltip_text = row.title;
            row.infoLabel.label = formatProfileDetails(profile, displays, lid, _);
        }
    }

    async #transferProfiles(importing) {
        if (this.#fileCancellable !== null)
            return;
        const cancellable = new Gio.Cancellable();
        this.#fileCancellable = cancellable;
        const buttons = ['exportProfilesButton', 'importProfilesButton'].map(id => this.#builder.get_object(id));
        for (const button of buttons)
            button.sensitive = false;
        try {
            Gio._promisify(Gtk.FileDialog.prototype, 'open');
            Gio._promisify(Gtk.FileDialog.prototype, 'save');
            const filter = new Gtk.FileFilter({ name: _('My Vision profile backups (*.json)') });
            filter.add_pattern('*.json');
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);
            const dialog = new Gtk.FileDialog({
                title: importing ? _('Import Profiles') : _('Export Profiles'),
                modal: true, filters, default_filter: filter,
            });
            if (!importing)
                dialog.initial_name = 'my-vision-profiles.json';
            const file = await (importing ? dialog.open(this.#root, cancellable) : dialog.save(this.#root, cancellable));
            cancellable.set_error_if_cancelled();
            if (importing) {
                const profiles = await readProfileBackup(file, cancellable);
                cancellable.set_error_if_cancelled();
                // Merge into the latest settings, including edits made while the chooser was open.
                this.#store.reload();
                const result = mergeProfiles(this.#store.profiles, profiles);
                if (result.added > 0) {
                    this.#store.profiles = result.profiles;
                    this.#store.save();
                }
                windowToast(this.#root, _('Imported profiles: %s. Duplicates skipped: %s.')
                    .replace('%s', result.added).replace('%s', result.skipped));
            } else {
                this.#store.reload();
                const text = exportProfiles(this.#store.profiles);
                await writeProfileBackup(file, text, cancellable);
                cancellable.set_error_if_cancelled();
                windowToast(this.#root, _('Profiles exported.'));
            }
        } catch (error) {
            const dismissed = error instanceof GLib.Error && error.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED);
            if (!cancellable.is_cancelled() && !isCancelled(error) && !dismissed)
                windowToast(this.#root, `${importing ? _('Could not import profiles') : _('Could not export profiles')}: ${error.message.slice(0, 300)}`);
        } finally {
            if (!cancellable.is_cancelled()) {
                this.#fileCancellable = null;
                for (const button of buttons)
                    button.sensitive = true;
            }
        }
    }

}

function windowToast(window, title) {
    window.add_toast(new Adw.Toast({ title }));
}

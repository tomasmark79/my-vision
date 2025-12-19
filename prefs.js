import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PrefsWidgets } from './prefs_widgets.js';

const NAME_INDEX = 0;
const HASH_INDEX = 1;
const LOGICAL_MONITORS_INDEX = 2;
const PROPERTIES_INDEX = 3;
const PHYSICAL_DISPLAYS_INDEX = 4;

export default class MyVisionPreferences extends ExtensionPreferences
{
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
        const configListBox =  this.#builder.get_object('configListbox');
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
        this.#settings.connect('changed::configs', () => {
            this.#onConfigsChanged();
        });

        // Call handler for initial fill of config list
        this.#onConfigsChanged();

        // Handle the close-request signal to drop all references
        window.connect('close-request', () => {
            this.#builder = null;
            this.#configs = null;
            this.#root = null;
            this.#settings = null;

            PrefsWidgets.clear();
        });
    }

    #onConfigsChanged() {
        this.#configs = this.#settings.get_value('configs').deepUnpack();

        this.#updateConfigGroup();
    }

    #saveConfigs() {
        const configsVariant = new GLib.Variant('a(sua(iiduba(ssa{sv}))a{sv}a(ss))', this.#configs);
        this.#settings.set_value('configs', configsVariant);
    }

    #prettyPrintConfig(config) {
        const hash = config[HASH_INDEX];
        const logicalMonitors = config[LOGICAL_MONITORS_INDEX];
        const properties = config[PROPERTIES_INDEX];
        const physicalDisplays = config[PHYSICAL_DISPLAYS_INDEX];
        let res = '';

        res += 'Logical monitors:\n';
        for (const [index, logicalMonitor] of logicalMonitors.entries()) {
            res +=
                `${index + 1})\t(x, y) = (${logicalMonitor[0]}, ${logicalMonitor[1]})\n` +
                `\tscale = ${logicalMonitor[2]}\n` +
                `\ttransform = ${logicalMonitor[3]}\n` +
                `\tprimary = ${logicalMonitor[4]}\n` +
                `\tmonitors:\n`;
            for (const [index, monitor] of logicalMonitor[5].entries()) {
                res +=
                    `\t${index + 1})\t- connector = ${monitor[0]}\n` +
                    `\t\t- monitor mode ID = ${monitor[1]}\n`;
                const underscanning = monitor[2]['underscanning'];
                if (underscanning !== undefined) {
                    res += `\t\t- underscanning = ${underscanning.get_boolean()}\n`;
                }
            }
        }

        res += 'Properties:\n';
        const layoutMode = properties['layout-mode'];
        if (layoutMode !== undefined) {
            res += `\tlayout-mode = ${layoutMode.get_uint32()}\n`;
        }

        res += 'Physical displays:\n';
        for (const [index, display] of physicalDisplays.entries()) {
            // Support both old format [connector, vendor, product, serial] and new format [connector, displayName]
            if (display.length === 2) {
                // New format
                res +=
                    `${index + 1})\t- connector = ${display[0]}\n` +
                    `\t- displayName = ${display[1]}\n`;
            } else {
                // Old format (legacy)
                res +=
                    `${index + 1})\t- connector = ${display[0]}\n` +
                    `\t- vendor = ${display[1]}\n` +
                    `\t- product = ${display[2]}\n` +
                    `\t- serial = ${display[3]}\n`;
            }
        }

        res += `Config hash: ${hash}`;

        return res;
    }

    #updateConfigGroup() {
        const configListBox =  this.#builder.get_object('configListbox');
        for (let row; (row = configListBox.get_last_child()) !== null; ) {
            configListBox.remove(row);
        }

        for (const [index, config] of this.#configs.entries()) {
            const row = PrefsWidgets.createConfigRow({});

            row.text = config[NAME_INDEX];
            row.title = this.#printPhysicalDisplays(config);
            row.tooltip_text = row.title;
            row.infoLabel.label = this.#prettyPrintConfig(config);

            row.connect('apply', () => { this.#onEditApply(index); });
            row.connect('remove-clicked', () => { this.#onRemoveClicked(index); });

            row.setupDragAndDrop(configListBox, index);

            configListBox.append(row);
        }
    }

    #printPhysicalDisplays(config) {
        const physicalDisplays = config[PHYSICAL_DISPLAYS_INDEX];
        let res = [];

        for (const display of physicalDisplays) {
            // Support both formats: new [connector, displayName] and old [connector, vendor, product, serial]
            if (display.length === 2) {
                // New format
                res.push(`${display[1] || 'Unknown'} (${display[0]})`);
            } else {
                // Old format - use product or vendor
                const name = display[2] || display[1] || 'Unknown';
                res.push(`${name} (${display[0]})`);
            }
        }
        return _('Displays: ') + res.join(', ');
    }

    #onEditApply(index) {
        const configListBox =  this.#builder.get_object('configListbox');
        this.#configs[index][NAME_INDEX] = configListBox.get_row_at_index(index).get_text();
        this.#saveConfigs();
    }

    #onRemoveClicked(index) {
        this.#configs.splice(index, 1);
        this.#saveConfigs();
    }
}

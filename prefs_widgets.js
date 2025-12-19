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
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export class PrefsWidgets {
    /**
     * Row widget class for displaying and editing configuration in the preferences window
     * 
     * @type {?class}
     */
    static #ConfigRow = null;
    /**
     * Drag widget class to display when dragging a ConfigRow
     * 
     * @type {?class}
     */
    static #ConfigRowDragWidget = null;
    /**
     * Dialog class for modifying a keyboard shortcut
     * 
     * @type {?class}
     */
    static #ShortcutDialog = null;
    /**
     * Dialog for modifying a keyboard shortcut
     * 
     * @type {?ShortcutDialog}
     */
    static #shortcutDialog = null;
    /**
     * Row widget class for displaying and modifying keyboard shortcut
     * 
     * @type {?class} 
     */
    static #ShortcutRow = null;

    /**
     * Format accelerator key and modifiers into human-readable label
     * @param {number} key - keyval
     * @param {number} mods - modifier flags
     * @returns {string} formatted label
     */
    static #formatAccelerator(key, mods) {
        return Gtk.accelerator_get_label(key, mods) || '';
    }

    static initialize() {
        if (this.#ConfigRow)
            return;

        this.#ConfigRowDragWidget = GObject.registerClass({
            GTypeName: 'ConfigRowDragWidget',
            Template: 'resource:///org/gnome/Shell/Extensions/my-vision/ui/config_row_drag_widget.ui',
            Children: ['entryRow'],
        }, class ConfigRowDragWidget extends Gtk.ListBox {
            constructor(text, title) {
                super();
                this.entryRow.text = text;
                this.entryRow.title = title;
            }           
        });

        this.#ConfigRow = GObject.registerClass({
            GTypeName: 'ConfigRow',
            Signals: {
                'remove-clicked': {},
            },
            Template: 'resource:///org/gnome/Shell/Extensions/my-vision/ui/config_row.ui',
            Children: ['infoLabel'],
        }, class ConfigRow extends Adw.EntryRow {
            constructor(props) {
                super(props);
                this.show_apply_button = true;
            }

            setupDragAndDrop(list, index) {
                const dropController = new Gtk.DropControllerMotion();
                const dragSource = new Gtk.DragSource({
                    actions: Gdk.DragAction.MOVE,
                });
                this.add_controller(dragSource);
                this.add_controller(dropController);
    
                let dragX;
                let dragY;
    
                dragSource.connect("prepare", (_source, x, y) => {
                    dragX = x;
                    dragY = y;
    
                    const value = new GObject.Value();
                    value.init(GObject.TYPE_INT);
                    value.set_int(index);
    
                    return Gdk.ContentProvider.new_for_value(value);
                });
    
                dragSource.connect("drag-begin", (_source, drag) => {
                    const dragWidget = PrefsWidgets.createConfigRowDragWidget(this.text, this.title);
    
                    dragWidget.set_size_request(this.get_width(), this.get_height());
                    dragWidget.drag_highlight_row(dragWidget.entryRow);
    
                    const icon = Gtk.DragIcon.get_for_drag(drag);
                    icon.child = dragWidget;
    
                    drag.set_hotspot(dragX, dragY);
                });
    
                dropController.connect("enter", () => {
                    list.drag_highlight_row(this);
                });
    
                dropController.connect("leave", () => {
                    list.drag_unhighlight_row();
                });
            }

            _onRemoveButtonClicked() {
                this.emit('remove-clicked');
            }
        });

        this.#ShortcutDialog = GObject.registerClass({
            GTypeName: 'ShortcutDialog',
            Template: 'resource:///org/gnome/Shell/Extensions/my-vision/ui/shortcut_dialog.ui',
            Children: ['shortcutLabel'],
        }, class ShortcutDialog extends Adw.AlertDialog {
            #accelerator = '';

            constructor() {
                super();

                this.#setupEventController();
            }

            #setupEventController() {
                const eventController = new Gtk.EventControllerKey();
                eventController.connect('key-pressed', this.#onKeyPressed.bind(this));

                this.add_controller(eventController);
            }

            #onKeyPressed(eventController, key, keycode, mod) {
                const event = eventController.get_current_event();

                if (event.is_modifier()) { return false; }
                
                // Sanitize modifier flags to only include valid Gdk.ModifierType values
                const validMod = mod & (
                    Gdk.ModifierType.SHIFT_MASK |
                    Gdk.ModifierType.CONTROL_MASK |
                    Gdk.ModifierType.ALT_MASK |
                    Gdk.ModifierType.SUPER_MASK |
                    Gdk.ModifierType.HYPER_MASK |
                    Gdk.ModifierType.META_MASK
                );

                if ((validMod & Gdk.ModifierType.CONTROL_MASK) && key < 0x20) {
                    const display = Gdk.Display.get_default();
                    const cleanMod = validMod & ~Gdk.ModifierType.CONTROL_MASK;

                    let [ok, newKey, , , ] = display.translate_key(keycode, cleanMod, 0);
                    if (ok && newKey >= 0x20) {
                        key = newKey;
                    } else {
                        [ok, newKey, , , ] = display.translate_key(keycode, cleanMod, 1);
                        if (ok && newKey >= 0x20) {
                            key = newKey;
                        }
                    }
                }
                
                const accelerator = Gtk.accelerator_name(key, validMod);
                this.set_accelerator(accelerator);
                
                return true;
            }

            set_accelerator(accelerator) {
                this.#accelerator = accelerator;
                const [ok, key, mods] = Gtk.accelerator_parse(accelerator);
                
                // Sanitize modifier flags to only include valid Gdk.ModifierType values
                const validMods = mods & (
                    Gdk.ModifierType.SHIFT_MASK |
                    Gdk.ModifierType.CONTROL_MASK |
                    Gdk.ModifierType.ALT_MASK |
                    Gdk.ModifierType.SUPER_MASK |
                    Gdk.ModifierType.HYPER_MASK |
                    Gdk.ModifierType.META_MASK
                );
                
                if (ok && key !== 0) {
                    const label = PrefsWidgets.#formatAccelerator(key, validMods);
                    this.shortcutLabel.set_label(label);
                } else {
                    this.shortcutLabel.set_label(accelerator || '');
                }
            }

            get_accelerator() {
                return this.#accelerator;
            }
        });

        this.#ShortcutRow = GObject.registerClass({
            GTypeName: 'ShortcutRow',
            Signals: {
                'edit-clicked': {},
            },
            Template: 'resource:///org/gnome/Shell/Extensions/my-vision/ui/shortcut_row.ui',
            Children: ['shortcutLabel'],
        }, class ShortcutRow extends Adw.ActionRow {

            /**
             * Key for the shortcut setting
             * 
             * @type {string}
             */
            #key = "";
            /**
             * Gio.Settings object associated with the extension
             * 
             * @type {Settings|null}
             */
            #settings = null;
            /**
             * Handler id for response signal of the ShortcutDialog 
             * 
             * @type {Number|null}
             */
            #shortcutDialogResponseHandlerID = null;
            /**
             * Current accelerator string
             * 
             * @type {string}
             */
            #accelerator = '';

            constructor(title, key, settings) {
                super();
                this.title = title;

                this.#key = key;
                this.#settings = settings;

                // Defer loading the accelerator until the template is fully initialized
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.#loadAcceleratorSetting();
                    return GLib.SOURCE_REMOVE;
                });
            }

            get accelerator() {
                return this.#accelerator;
            }

            set accelerator(value) {
                this.#accelerator = value;
                // Format accelerator for display using GTK's built-in function
                const [ok, key, mods] = Gtk.accelerator_parse(value);
                
                // Sanitize modifier flags to only include valid Gdk.ModifierType values
                const validMods = mods & (
                    Gdk.ModifierType.SHIFT_MASK |
                    Gdk.ModifierType.CONTROL_MASK |
                    Gdk.ModifierType.ALT_MASK |
                    Gdk.ModifierType.SUPER_MASK |
                    Gdk.ModifierType.HYPER_MASK |
                    Gdk.ModifierType.META_MASK
                );
                
                if (ok && key !== 0) {
                    const label = PrefsWidgets.#formatAccelerator(key, validMods);
                    this.shortcutLabel.set_label(label);
                } else {
                    this.shortcutLabel.set_label(value || '');
                }
            }

            _onEditButtonClicked() {                
                const shortcutDialog = PrefsWidgets.getShortcutDialog();
                
                shortcutDialog.set_accelerator(this.accelerator);

                this.#shortcutDialogResponseHandlerID = shortcutDialog.connect(
                    'response',
                    (dialog, response) => this.#onShortcutDialogResponse(dialog, response)
                );
                shortcutDialog.present(this);
            }

            #onShortcutDialogResponse(shortcutDialog, response) {
                if (response === "confirm") {
                    const originalAccelerator = this.accelerator
                    const newAccelerator = shortcutDialog.get_accelerator();
                    if (newAccelerator !== originalAccelerator) {
                        this.accelerator = newAccelerator;
                        this.#saveAcceleratorSetting();
                    }
                }
                shortcutDialog.disconnect(this.#shortcutDialogResponseHandlerID);
                shortcutDialog.close();
            }
            
            #loadAcceleratorSetting() {
                const accelerator_setting = this.#settings.get_strv(this.#key);
                const accelerator = accelerator_setting.length > 0 ? accelerator_setting[0] : '';
                this.accelerator = accelerator;
            }

            #saveAcceleratorSetting() {
                const accelerator = this.accelerator;
                this.#settings.set_strv(
                    this.#key,
                    [ accelerator ]
                );
            }
        });
    }

    static clear() {
        this.#ConfigRow = null;
        this.#ConfigRowDragWidget = null;
        this.#ShortcutDialog = null;
        this.#ShortcutRow = null;

        this.#shortcutDialog = null;
    }

    static getShortcutDialog() {
        return new this.#ShortcutDialog();
    }

    static createConfigRow(props) {
        return new this.#ConfigRow(props);
    }

    static createConfigRowDragWidget(text, title) {
        return new this.#ConfigRowDragWidget(text, title);
    }

    static createShortcutRow(title, key, settings) {
        return new this.#ShortcutRow(title, key, settings);
    }
}

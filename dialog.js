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

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const NameDialog = GObject.registerClass(
class NameDialog extends ModalDialog.ModalDialog {
    _init(params = {}) {
        params.destroyOnClose = false;
        super._init(params);

        this._initContent();

        this._initButtons();

        this._valid = false;

        this.connect('opened', () => {
            this._entry.grab_key_focus();
        });
    }

    _initContent() {
        const boxLayout = new St.BoxLayout();
        boxLayout.set_vertical(true);

        this._message = new St.Label();
        this._entry = new St.Entry();
        this._entry.clutter_text.connect('activate', () => {
            this._valid = true;
            this.close();
        })

        boxLayout.add_child(this._message);
        boxLayout.add_child(this._entry);

        this.contentLayout.add_child(boxLayout);
    }

    _initButtons() {
        this.setButtons([
            {
                label: 'Cancel',
                action: () => {
                    this._valid = false;
                    this.close();
                },
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Confirm',
                action: () => {
                    this._valid = true;
                    this.close();
                },
            }
        ]);
    }

    setMessage(message) {
        this._message.set({
            text: message,
            visible: true,
        });
    }

    getName() {
        return this._entry.get_text();
    }

    setName(name) {
        this._entry.set_text(name);
    }

    isValid() {
        return this._valid;
    }
});

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

import { ConfigIndex, updateConfigHash, matchesMonitorsConfig } from './config.js';
import {mapDisplays, displayRecord, remapLogical, profileRequest, contextKey} from './profiles.js';

export const DisplayConfigSwitcher = GObject.registerClass(
class DisplayConfigSwitcher extends GObject.Object {
    constructor(onStateChanged = null, constructProperties = {}) {
        super(constructProperties);
        this._proxy = null;
        this._lidProxy = null;
        this._lidHandlers = [];
        this._lidState = 'unknown';
        this._cancellable = new Gio.Cancellable();
        this._stateRequestId = 0;
        this._currentState = null;
        this._monitorsChangedHandler = null;
        this._updateStateTimeoutId = null;
        this._isApplyingConfig = false;
        this._destroyed = false;
        this._onStateChangedCallback = onStateChanged;

        this._initProxy().catch(error => {
            if (!this._destroyed)
                logError(error, 'Failed to initialize display configuration');
        });
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        if (this._lidProxy) {
            for (const handler of this._lidHandlers)
                this._lidProxy.disconnect(handler);
            this._lidProxy = null;
        }
        this._lidHandlers = [];
        this._onStateChangedCallback = null;
        this._stateRequestId++;
        if (this._proxy !== null && this._monitorsChangedHandler !== null) {
            this._proxy.disconnect(this._monitorsChangedHandler);
            this._monitorsChangedHandler = null;
        }
        if (this._updateStateTimeoutId !== null) {
            GLib.source_remove(this._updateStateTimeoutId);
            this._updateStateTimeoutId = null;
        }
        this._proxy = null;
    }

    async _initProxy() {
        Gio._promisify(Gio.DBusProxy, 'new_for_bus');

        const proxy = await Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig',
            this._cancellable
        );

        if (this._destroyed) {
            return;
        }

        this._proxy = proxy;
        Gio._promisify(this._proxy, 'call');

        this._monitorsChangedHandler = this._proxy.connect('g-signal::MonitorsChanged',
            () => {
                this._debouncedUpdateState();
            });

        await this._initLidProxy();
        this._debouncedUpdateState();
    }

    async _initLidProxy() {
        try {
            const proxy = await Gio.DBusProxy.new_for_bus(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
                'org.freedesktop.UPower', '/org/freedesktop/UPower',
                'org.freedesktop.UPower', this._cancellable);
            if (this._destroyed)
                return;
            this._lidProxy = proxy;
            Gio._promisify(proxy, 'call');
            const update = () => {
                const present = proxy.get_cached_property('LidIsPresent')?.get_boolean();
                const closed = proxy.get_cached_property('LidIsClosed')?.get_boolean();
                this._lidState = !proxy.get_name_owner() || present === undefined || closed === undefined
                    ? 'unknown' : present ? (closed ? 'closed' : 'open') : 'any';
                this._debouncedUpdateState();
            };
            this._lidHandlers.push(proxy.connect('g-properties-changed', update));
            this._lidHandlers.push(proxy.connect('notify::g-name-owner', update));
            update();
        } catch (error) {
            if (!this._destroyed)
                console.warn(`Cannot read laptop lid state: ${error.message}`);
        }
    }

    getLidState() {
        if (this._lidState === 'unknown' && this._currentState &&
            !this.getPhysicalDisplayInfo().some(d => d.builtin))
            return 'any';
        return this._lidState;
    }

    async refresh() {
        if (this._lidProxy) {
            try {
                const reply = await this._lidProxy.call('org.freedesktop.DBus.Properties.GetAll',
                    new GLib.Variant('(s)', ['org.freedesktop.UPower']),
                    Gio.DBusCallFlags.NONE, -1, this._cancellable);
                const [props] = reply.recursiveUnpack();
                if (!this._destroyed)
                    this._lidState = props.LidIsPresent === false ? 'any' :
                        props.LidIsPresent === true && typeof props.LidIsClosed === 'boolean'
                            ? (props.LidIsClosed ? 'closed' : 'open') : 'unknown';
            } catch (error) {
                this._lidState = 'unknown';
                if (this._destroyed)
                    throw error;
            }
        }
        return this._updateState(false);
    }

    _debouncedUpdateState() {
        if (this._destroyed)
            return;

        // Invalidate reads started before this monitor change.
        this._stateRequestId++;

        // Clear any pending update
        if (this._updateStateTimeoutId !== null) {
            GLib.source_remove(this._updateStateTimeoutId);
        }

        // Debounce updates to avoid rapid successive calls
        // 500ms delay gives monitors time to fully initialize after connection
        this._updateStateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateStateTimeoutId = null;
            if (this._isApplyingConfig)
                return GLib.SOURCE_REMOVE;
            this._updateState().catch(error => {
                if (!this._destroyed)
                    logError(error, 'Failed to refresh display configuration');
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    getMonitorsConfig() {
        if (this._currentState === null) { return null; }

        const config = Array(5).fill(null);

        config[ConfigIndex.PROPERTIES] = {};
        const properties = this._currentState[3];


        if (properties["supports-changing-layout-mode"] === true) {
            const layoutMode = properties["layout-mode"];
            if (layoutMode !== undefined) {
                // Immediately save a{sv} values as GVariant for easy packing later
                config[ConfigIndex.PROPERTIES]["layout-mode"] = GLib.Variant.new_uint32(layoutMode);
            }
        }

        config[ConfigIndex.LOGICAL_MONITORS] = this._getUpdatedLogicalMonitors();

        const physicalDisplays = this.getPhysicalDisplayInfo();
        // Store physical properties for robust identification
        // Use displayName as unique identifier (vendor/product/serial are often empty)
        config[ConfigIndex.PHYSICAL_DISPLAYS] = physicalDisplays.map(v => [
            v.id[0],         // connector
            v.displayName    // displayName (unique identifier)
        ]);

        updateConfigHash(config);

        return config;
    }

    // Remaps connector names in a saved configuration to current connectors
    // based on physical display properties (vendor, product, serial)
    remapConnectorsInConfig(savedLogicalMonitors, savedPhysicalDisplays) {
        const saved = savedPhysicalDisplays.map(([connector, name]) => ({connector, name}));
        return remapLogical(savedLogicalMonitors,
            mapDisplays(saved, this.getPhysicalDisplayInfo().map(displayRecord)));
    }

    async applyProfile(profile) {
        return this.applyMonitorsConfig(profile.config[2], profile.config[3], false, profile);
    }

    async applyMonitorsConfig(logicalMonitors, properties, usePrompt = false, profile = null) {
        if (this._destroyed || this._proxy === null || this._currentState === null)
            throw new Error('Display configuration is not ready');
        if (this._isApplyingConfig)
            return;

        const expectedContext = profile ? contextKey(this.getPhysicalDisplayInfo().map(displayRecord), this.getLidState()) : null;
        this._isApplyingConfig = true;
        try {
            // Refresh the serial and check the actual layout before sending a modeset.
            // Do not publish this intermediate read to the menu.
            if (!await this.refresh()) {
                const error = new Error('Displays changed while preparing the configuration; try again');
                error.code = 'STATE_CHANGED';
                throw error;
            }
            if (profile && expectedContext !== contextKey(this.getPhysicalDisplayInfo().map(displayRecord), this.getLidState()))
                throw new Error('The lid or connected monitors changed while preparing the profile');
            if (profile)
                logicalMonitors = profileRequest(profile, this.getPhysicalDisplayInfo(), this.getLidState());
            if (matchesMonitorsConfig(logicalMonitors, properties, this.getMonitorsConfig()))
                return;

            const parameters = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
                this._currentState[0],
                usePrompt ? 2 : 1,
                logicalMonitors,
                properties,
            ]);
            await this._proxy.call(
                'ApplyMonitorsConfig', parameters, Gio.DBusCallFlags.NONE,
                -1, this._cancellable
            );
        } finally {
            this._isApplyingConfig = false;
            // Keep MonitorsChanged events, including those emitted during Apply.
            // No pending Promise depends on a timer that destroy() can remove.
            this._debouncedUpdateState();
        }
    }

    async _updateState(notify = true) {
        if (this._destroyed || this._proxy === null)
            return false;

        const requestId = ++this._stateRequestId;
        const reply = await this._proxy.call(
            'GetCurrentState', null, Gio.DBusCallFlags.NONE,
            -1, this._cancellable
        );
        if (this._destroyed || requestId !== this._stateRequestId)
            return false;

        this._currentState = reply.recursiveUnpack();
        if (notify && this._onStateChangedCallback)
            this._onStateChangedCallback();
        return true;
    }

    hasState() {
        return this._currentState !== null;
    }

    getPhysicalDisplayInfo() {
        if (this._currentState === null) { return null; }

        const monitors = this._currentState[1];
        const displays = [];

        for (let monitor of monitors) {
            const [id, modes, props] = monitor;
            const display = {};

            display.id = id;
            // Store physical properties for robust identification
            display.vendor = id[1];
            display.product = id[2];
            display.serial = id[3];
            display.displayName = props["display-name"] || "";
            
            // console.log(`Display ${id[0]}: vendor="${display.vendor}", product="${display.product}", serial="${display.serial}", displayName="${display.displayName}"`);
            
            display.builtin = props['is-builtin'] === true;
            display.modes = modes;
            display.supportedColorModes = props['supported-color-modes'];
            display.props = {};

            const enableUnderscanning = props["is-underscanning"];
            if (enableUnderscanning !== undefined) {
                // Immediately save a{sv} values as GVariant for easy packing later
                display.props["underscanning"] = GLib.Variant.new_boolean(enableUnderscanning);
            }
            const colorMode = props["color-mode"];
            if (colorMode !== undefined) {
                display.props["color-mode"] = GLib.Variant.new_uint32(colorMode)
                ;
            }
            for (let mode of modes) {
                const [mode_id, width, height, refresh, , , opt_props] = mode;
                if (opt_props['is-current']) {
                    display.mode_id = mode_id;
                    // console.log(`Display ${id[0]}: mode_id=${mode_id} (${typeof mode_id}), resolution=${width}x${height}@${refresh}`);
                }
            }

            displays.push(display);
        }
        return displays;
    }

    _getUpdatedLogicalMonitors() {
        if (this._currentState === null) {
            return null;
        }

        const logicalMonitors = this._currentState[2];
        const updatedLogicalMonitors = [];
        const displays = this.getPhysicalDisplayInfo();

        for (let logicalMonitor of logicalMonitors) {
            const [x, y, scale, transform, primary, monitors,] = logicalMonitor;
            const updatedLogicalMonitor = [x, y, scale, transform, primary, []]
            for (let monitor of monitors) {
                const id = monitor;
                for (let disp of displays) {
                    if (id.every((element, index) => element === disp.id[index])) {
                        updatedLogicalMonitor[5].push([disp.id[0], disp.mode_id, disp.props]);
                    }
                }
            }
            // Make sure to sort for correct hash later - use deterministic comparator
            updatedLogicalMonitor[5].sort((a, b) => {
                // Sort by connector string (first element)
                const connectorA = a[0] || "";
                const connectorB = b[0] || "";
                if (connectorA < connectorB) return -1;
                if (connectorA > connectorB) return 1;
                // If connectors are same, sort by mode_id
                return (a[1] || 0) - (b[1] || 0);
            });
            updatedLogicalMonitors.push(updatedLogicalMonitor);
        }
        // Make sure to sort for correct hash later - use deterministic comparator
        updatedLogicalMonitors.sort((a, b) => {
            // Sort by x position, then y position
            if (a[0] !== b[0]) return a[0] - b[0];
            if (a[1] !== b[1]) return a[1] - b[1];
            // Then by primary status (primary first)
            if (a[4] !== b[4]) return b[4] ? 1 : -1;
            return 0;
        });
        return updatedLogicalMonitors;
    }

});

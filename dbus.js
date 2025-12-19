import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { ConfigIndex, updateConfigHash } from './config.js'

export const DisplayConfigSwitcher = GObject.registerClass({
    Signals: {
        'state-changed': {},
    },
}, class DisplayConfigSwitcher extends GObject.Object {
    constructor(constructProperties = {}) {
        super(constructProperties);
        this._currentState = null;
        this._monitorsChangedHandler = null;
        this._updateStateTimeoutId = null;
        this._applyConfigTimeoutId = null;
        this._isApplyingConfig = false;
        this._destroyed = false;

        this._initProxy();
    }

    disconnectSignals() {
        this._destroyed = true;
        if (this._proxy !== null && this._monitorsChangedHandler !== null) {
            this._proxy.disconnect(this._monitorsChangedHandler);
            this._monitorsChangedHandler = null;
        }
        if (this._updateStateTimeoutId !== null) {
            GLib.source_remove(this._updateStateTimeoutId);
            this._updateStateTimeoutId = null;
        }
        if (this._applyConfigTimeoutId !== null) {
            GLib.source_remove(this._applyConfigTimeoutId);
            this._applyConfigTimeoutId = null;
        }
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
            null
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

        this._updateState();
    }

    _debouncedUpdateState() {
        // Ignore monitor changes while we're applying a config
        if (this._isApplyingConfig) {
            return;
        }

        // Clear any pending update
        if (this._updateStateTimeoutId !== null) {
            GLib.source_remove(this._updateStateTimeoutId);
        }

        // Debounce updates to avoid rapid successive calls
        // 500ms delay gives monitors time to fully initialize after connection
        this._updateStateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateStateTimeoutId = null;
            this._updateState();
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
        if (this._currentState === null) {
            return savedLogicalMonitors;
        }

        const currentDisplays = this.getPhysicalDisplayInfo();
        
        // Validate for duplicate displayNames (can cause remapping issues)
        const displayNamesSeen = new Set();
        for (let display of currentDisplays) {
            if (display.displayName && displayNamesSeen.has(display.displayName)) {
                console.warn(`WARNING: Duplicate displayName detected: "${display.displayName}" - connector remapping may be unreliable!`);
            }
            displayNamesSeen.add(display.displayName);
        }
        
        // Build mapping from old connector names to new connector names
        const connectorMap = {};
        
        for (let savedDisplay of savedPhysicalDisplays) {
            // Support both old format [connector, vendor, product, serial] and new format [connector, displayName]
            const savedConnector = savedDisplay[0];
            const savedDisplayName = savedDisplay.length === 2 ? savedDisplay[1] : 
                                   (savedDisplay[1] || savedDisplay[2] || savedDisplay[3] || "");
            
            // If displayName is empty (legacy format), skip physical matching
            // and just use the connector as-is
            if (!savedDisplayName) {
                // console.log(`Legacy config detected for ${savedConnector}, skipping physical matching`);
                connectorMap[savedConnector] = savedConnector;
                continue;
            }
            
            // Find matching current display by displayName
            const matchingDisplay = currentDisplays.find(currentDisplay => 
                currentDisplay.displayName === savedDisplayName
            );
            
            if (matchingDisplay) {
                console.log(`Mapped ${savedConnector} ("${savedDisplayName}") -> ${matchingDisplay.id[0]}`);
                connectorMap[savedConnector] = matchingDisplay.id[0];
            } else {
                console.warn(`No matching display found for ${savedConnector} ("${savedDisplayName}")`);
                connectorMap[savedConnector] = savedConnector;
            }
        }
        
        // Apply the mapping to logical monitors
        const remappedLogicalMonitors = [];
        
        for (let logicalMonitor of savedLogicalMonitors) {
            const [x, y, scale, transform, primary, monitors] = logicalMonitor;
            const remappedMonitors = [];
            
            for (let monitor of monitors) {
                const [connector, modeId, props] = monitor;
                const newConnector = connectorMap[connector] || connector;
                
                // Find the current display to get valid mode_id and merge props
                const currentDisplay = currentDisplays.find(d => d.id[0] === newConnector);
                
                if (currentDisplay) {
                    // Use saved props but merge with current props for any missing values
                    const mergedProps = { ...currentDisplay.props };
                    
                    // Override with saved props if they exist
                    if (props) {
                        for (let key in props) {
                            mergedProps[key] = props[key];
                        }
                    }
                    
                    // Use current mode_id if available, otherwise keep saved mode_id
                    const validModeId = currentDisplay.mode_id || modeId;
                    
                    // console.log(`Remapping ${connector} -> ${newConnector}, mode_id: ${modeId} (${typeof modeId}) -> ${validModeId} (${typeof validModeId})`);
                    
                    remappedMonitors.push([newConnector, validModeId, mergedProps]);
                } else {
                    // Display not currently active, use saved configuration as-is
                    // console.log(`Display ${newConnector} not currently active, using saved config: mode_id=${modeId}`);
                    remappedMonitors.push([newConnector, modeId, props]);
                }
            }
            
            remappedLogicalMonitors.push([x, y, scale, transform, primary, remappedMonitors]);
        }
        
        return remappedLogicalMonitors;
    }

    async applyMonitorsConfig(logicalMonitors, properties, usePrompt = false) {
        if (this._proxy === null) {
            log('Proxy is not initialized');
            throw new Error('Proxy is not initialized');
        }

        const parameters = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
            this._currentState[0],
            usePrompt ? 2 : 1,
            logicalMonitors,
            properties,
        ]);

        this._isApplyingConfig = true;

        // console.log('Applying monitors config:', JSON.stringify(logicalMonitors, null, 2));

        try {
            await this._proxy.call(
                'ApplyMonitorsConfig',
                parameters,
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            
            // Give the system time to apply the config before we respond to MonitorsChanged
            // Increased timeout from 500ms to 1000ms to prevent race conditions on slower systems
            // Remove any existing apply timeout before creating a new one
            if (this._applyConfigTimeoutId !== null) {
                GLib.source_remove(this._applyConfigTimeoutId);
                this._applyConfigTimeoutId = null;
            }
            
            await new Promise(resolve => {
                this._applyConfigTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    this._applyConfigTimeoutId = null;
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (error) {
            console.error('Failed to apply monitors config via DBus:', error);
            throw error;
        } finally {
            this._isApplyingConfig = false;
            // Trigger an update now that config is applied
            this._updateState();
        }
    }

    async _updateState() {
        // Prevent crash if called after destroy
        if (this._proxy === null) {
            // console.log('Proxy is null, ignoring _updateState call');
            return;
        }
        
        const reply = await this._proxy.call(
            'GetCurrentState',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );
        this._currentState = reply.recursiveUnpack();
        this.emit('state-changed');
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
            display.vendor = props["vendor"] || "";
            display.product = props["product"] || "";
            display.serial = props["serial"] || "";
            display.displayName = props["display-name"] || "";
            
            // console.log(`Display ${id[0]}: vendor="${display.vendor}", product="${display.product}", serial="${display.serial}", displayName="${display.displayName}"`);
            
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

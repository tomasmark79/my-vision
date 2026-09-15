// Run with: gjs -m tests/initialization.js
// Exercise the real initialization methods with controlled asynchronous proxies.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DisplayConfigSwitcher, isCancelled} from '../dbus.js';

function assert(value, message) {if (!value) throw new Error(message);}
const deferred = () => {
    let resolve;
    const promise = new Promise(r => {resolve = r;});
    return {promise, resolve};
};
const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
function proxy(lid = false) {
    const handlers = new Map();
    const calls = [];
    return {
        handlers, calls,
        connect(signal, callback) {const id = handlers.size + 1; handlers.set(id, [signal, callback]); return id;},
        disconnect(id) {assert(handlers.delete(id), 'Disconnect must match an owned signal');},
        get_cached_property(name) {return new GLib.Variant('b', name === 'LidIsPresent' || lid);},
        get_name_owner() {return ':1.100';},
        async call(method) {
            calls.push(method);
            return {recursiveUnpack: () => [1, [], [], {}]};
        },
    };
}
const initialize = DisplayConfigSwitcher.prototype._initProxy;
const newForBus = Gio.DBusProxy.new_for_bus;
const promisify = Gio._promisify;
DisplayConfigSwitcher.prototype._initProxy = async function () {};
// Fake transports already return promises. Production still uses Gio's wrapper.
Gio._promisify = () => {};
try {
    {
        const display = proxy();
        const lid = proxy(true);
        const buses = [];
        Gio.DBusProxy.new_for_bus = async bus => {
            buses.push(bus);
            return bus === Gio.BusType.SESSION ? display : lid;
        };
        let notifications = 0;
        const switcher = new DisplayConfigSwitcher(() => {notifications++;});
        await initialize.call(switcher);
        assert(buses.length === 2 && buses[0] === Gio.BusType.SESSION && buses[1] === Gio.BusType.SYSTEM,
            'Initialize display proxy followed by UPower proxy');
        assert(display.handlers.size === 1 && lid.handlers.size === 2, 'Acquire exactly the required signal handlers');
        assert(switcher.getLidState() === 'closed', 'Read initial lid state before publishing monitors');
        await delay(600);
        assert(notifications === 1 && display.calls.length === 1 && display.calls[0] === 'GetCurrentState',
            'Initialization publishes one debounced read and never applies a monitor mode');
        switcher.destroy();
        assert(display.handlers.size === 0 && lid.handlers.size === 0, 'Destroy disconnects both proxies');
        assert(switcher._proxy === null && switcher._lidProxy === null && switcher._cancellable === null,
            'Destroy releases proxies and cancellation ownership');
    }
    {
        const pending = deferred();
        const display = proxy();
        let creations = 0;
        Gio.DBusProxy.new_for_bus = () => {creations++; return pending.promise;};
        const switcher = new DisplayConfigSwitcher();
        const initialization = initialize.call(switcher);
        // Completion is queued before cancellation, but continuation has not run.
        pending.resolve(display);
        switcher.destroy();
        let cancelled = false;
        try {await initialization;} catch (error) {cancelled = isCancelled(error);}
        assert(cancelled && creations === 1 && display.handlers.size === 0,
            'Cancellation before the first continuation must prevent handlers and UPower initialization');
        assert(switcher._updateStateTimeoutId === null, 'Cancelled initialization cannot create a timer');
    }
    {
        const display = proxy();
        const lid = proxy();
        const pending = deferred();
        const started = deferred();
        Gio.DBusProxy.new_for_bus = bus => {
            if (bus === Gio.BusType.SESSION) return Promise.resolve(display);
            started.resolve();
            return pending.promise;
        };
        const switcher = new DisplayConfigSwitcher();
        const initialization = initialize.call(switcher);
        await started.promise;
        assert(display.handlers.size === 1, 'Display signal acquired before UPower is ready');
        switcher.destroy();
        pending.resolve(lid);
        let cancelled = false;
        try {await initialization;} catch (error) {cancelled = isCancelled(error);}
        assert(cancelled && display.handlers.size === 0 && lid.handlers.size === 0,
            'Cancellation during UPower initialization releases existing handlers and refuses late ones');
        assert(switcher._updateStateTimeoutId === null, 'Late UPower reply must not restart refresh');
    }
    {
        const failure = new Error('D-Bus connection unavailable');
        Gio.DBusProxy.new_for_bus = async () => {throw failure;};
        const switcher = new DisplayConfigSwitcher();
        let caught;
        try {await initialize.call(switcher);} catch (error) {caught = error;}
        assert(caught === failure, 'Initialization failure remains observable');
        switcher.destroy();
        assert(switcher._updateStateTimeoutId === null, 'Failed initialization leaves no timer');
    }
} finally {
    DisplayConfigSwitcher.prototype._initProxy = initialize;
    Gio.DBusProxy.new_for_bus = newForBus;
    Gio._promisify = promisify;
}
print('4 asynchronous initialization scenarios passed');

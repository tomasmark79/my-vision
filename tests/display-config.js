// Run with: gjs -m tests/display-config.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ConfigIndex, matchesMonitorsConfig} from '../config.js';
import {DisplayConfigSwitcher, isCancelled} from '../dbus.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
const logical = (mode = '1920x1080@60', x = 0) =>
    [[x, 0, 1, 0, true, [['DP-1', mode, {'color-mode': GLib.Variant.new_uint32(0)}]]]];
const config = [null, 0, logical(), {'layout-mode': GLib.Variant.new_uint32(1)}, [['DP-1', 'Panel']]];
assert(matchesMonitorsConfig(logical(), {}, config), 'Active configuration should be a no-op');
assert(!matchesMonitorsConfig(logical('1920x1080@75'), {}, config), 'Refresh rate must be compared');
assert(!matchesMonitorsConfig(logical('2560x1440@60'), {}, config), 'Resolution must be compared');
assert(!matchesMonitorsConfig(logical(undefined, 100), {}, config), 'Position must be compared');
assert(!matchesMonitorsConfig(logical(), {'layout-mode': GLib.Variant.new_uint32(2)}, config), 'Layout mode must be compared');
const legacy = logical();
legacy[0][5][0][2] = {};
assert(matchesMonitorsConfig(legacy, {}, config), 'Missing legacy color-mode must not trigger a modeset');
const reversed = [null, 0, [...logical(), ...logical(undefined, 1920)], {}, []];
assert(matchesMonitorsConfig([...reversed[2]].reverse(), {}, reversed), 'Monitor order must not trigger a modeset');

// Exercise the real switcher with a controlled D-Bus transport.
DisplayConfigSwitcher.prototype._initProxy = async function () {};
const makeSwitcher = () => {
    const switcher = new DisplayConfigSwitcher();
    switcher._currentState = [1];
    switcher.getMonitorsConfig = () => config;
    return switcher;
};
const reply = serial => ({recursiveUnpack: () => [serial]});
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return {promise, resolve};
};

{
    const switcher = makeSwitcher();
    const calls = [];
    switcher._proxy = {call: async (method, parameters) => {
        calls.push([method, parameters]);
        return reply(42);
    }};
    await switcher.applyMonitorsConfig(logical(), {});
    assert(calls.length === 1 && calls[0][0] === 'GetCurrentState', 'No redundant ApplyMonitorsConfig');
    await switcher.applyMonitorsConfig(logical('1920x1080@75'), {});
    assert(calls.length === 3 && calls[2][0] === 'ApplyMonitorsConfig', 'Changed mode must be applied once');
    assert(calls[2][1].recursiveUnpack()[0] === 42, 'Apply must use refreshed serial');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    const older = deferred();
    const newer = deferred();
    let calls = 0;
    switcher._proxy = {call: () => (++calls === 1 ? older.promise : newer.promise)};
    const first = switcher._updateState();
    const second = switcher._updateState();
    newer.resolve(reply(3));
    await second;
    older.resolve(reply(2));
    await first;
    assert(switcher._currentState[0] === 3, 'Late replies must not overwrite newer state');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    const pending = deferred();
    let notified = false;
    switcher._onStateChangedCallback = () => { notified = true; };
    switcher._proxy = {call: () => pending.promise};
    const read = switcher._updateState();
    switcher.destroy();
    pending.resolve(reply(2));
    let cancelled = false;
    try { await read; } catch (error) { cancelled = isCancelled(error); }
    assert(cancelled && !notified && switcher._currentState === null, 'Cancelled reads must not access released state');
}
{
    const switcher = makeSwitcher();
    const pending = deferred();
    let applies = 0;
    switcher._proxy = {call: method => {
        if (method === 'ApplyMonitorsConfig')
            applies++;
        return pending.promise;
    }};
    const apply = switcher.applyMonitorsConfig(logical('1920x1080@75'), {});
    await switcher.applyMonitorsConfig(logical(), {});
    switcher._debouncedUpdateState();
    pending.resolve(reply(2));
    let rejected = false;
    try { await apply; } catch { rejected = true; }
    assert(rejected && applies === 0, 'Topology changes during preparation must prevent stale Apply');
    assert(!switcher._isApplyingConfig, 'Failed preparation must release the mutex');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    switcher.getPhysicalDisplayInfo = () => [{id: ['DP-2'], displayName: 'Panel', mode_id: '1920x1080@60', props: {}}];
    const remapped = switcher.remapConnectorsInConfig(logical('1920x1080@75'), config[ConfigIndex.PHYSICAL_DISPLAYS]);
    assert(remapped[0][5][0][0] === 'DP-2', 'Connector must be remapped');
    assert(remapped[0][5][0][1] === '1920x1080@75', 'Saved mode must survive remapping');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    let notified = 0;
    switcher._onStateChangedCallback = () => { notified++; };
    switcher._proxy = {call: async method => {
        if (method === 'ApplyMonitorsConfig') {
            // Mutter may signal before the method reply arrives.
            switcher._debouncedUpdateState();
            switcher._debouncedUpdateState();
        }
        return reply(4);
    }};
    await switcher.applyMonitorsConfig(logical('1920x1080@75'), {});
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
    assert(notified === 1, 'Changes during Apply must produce one debounced refresh');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    const started = deferred();
    switcher._proxy = {call: async method => {
        if (method === 'GetCurrentState')
            return reply(4);
        started.resolve();
        return new Promise((resolve, reject) => {
            switcher._cancellable.connect(() => reject(new Error('Cancelled')));
        });
    }};
    const apply = switcher.applyMonitorsConfig(logical('1920x1080@75'), {});
    await started.promise;
    switcher.destroy();
    let rejected = false;
    try { await apply; } catch { rejected = true; }
    assert(rejected && switcher._proxy === null, 'Destroy during Apply must settle the request and release resources');
    assert(switcher._updateStateTimeoutId === null, 'Destroy must not schedule another refresh');
}
print('Display configuration regression tests passed');

// Profile validation happens after the fresh read, including lid/topology changes.
{
    const switcher = makeSwitcher();
    const display = {id: ['DP-1', 'Vendor', 'Panel', 'Serial'], displayName: 'Panel', builtin: false,
        modes: [['1920x1080@75', 1920, 1080, 75, 1, [1], {}]]};
    switcher.getPhysicalDisplayInfo = () => [display];
    switcher._lidState = 'open';
    const profile = {lid: 'any', config: ['', 0, logical('1920x1080@75'), {}, []],
        displays: [{connector: 'DP-1', name: 'Panel', vendor: 'Vendor', product: 'Panel', serial: 'Serial', builtin: false}]};
    let applies = 0;
    switcher._proxy = {call: async method => {
        if (method === 'ApplyMonitorsConfig') applies++;
        switcher._lidState = 'closed';
        return reply(5);
    }};
    let rejected = false;
    try { await switcher.applyProfile(profile); } catch { rejected = true; }
    assert(rejected && applies === 0, 'Lid changes while reading must cancel even an any-lid profile');
    switcher.destroy();
}
{
    const switcher = makeSwitcher();
    const display = {id: ['DP-1', 'Vendor', 'Panel', 'Serial'], displayName: 'Panel', builtin: false,
        modes: [['1920x1080@75', 1920, 1080, 75, 1, [1], {}]]};
    switcher.getPhysicalDisplayInfo = () => [display];
    switcher._lidState = 'closed';
    const profile = {lid: 'closed', config: ['', 0, logical('1920x1080@75'), {}, []],
        displays: [{connector: 'DP-1', name: 'Panel', vendor: 'Vendor', product: 'Panel', serial: 'Serial', builtin: false}]};
    let applied = null;
    switcher._proxy = {call: async (method, parameters) => {
        if (method === 'GetCurrentState') display.id[0] = 'DP-9';
        if (method === 'ApplyMonitorsConfig') applied = parameters.recursiveUnpack();
        return reply(6);
    }};
    await switcher.applyProfile(profile);
    assert(applied[0] === 6 && applied[2][0][5][0][0] === 'DP-9', 'Remap using refreshed connector names');
    assert(applied[2][0][5][0][1] === '1920x1080@75', 'Fresh remap retains saved refresh rate');
    switcher.destroy();
}
print('Lid and fresh connector validation tests passed');

{
    const switcher = makeSwitcher();
    const pending = deferred();
    switcher._lidProxy = {call: () => pending.promise};
    let monitorReads = 0;
    switcher._proxy = {call: async () => {monitorReads++; return reply(7);}};
    const refresh = switcher.refresh();
    switcher.destroy();
    pending.resolve({recursiveUnpack: () => [{LidIsPresent: true, LidIsClosed: false}]});
    let cancelled = false;
    try {await refresh;} catch (error) {cancelled = isCancelled(error);}
    assert(cancelled && monitorReads === 0, 'Cancelled lid read must not start another D-Bus request');
}
{
    const switcher = makeSwitcher();
    const pending = deferred();
    const original = Gio.DBusProxy.new_for_bus;
    Gio.DBusProxy.new_for_bus = () => pending.promise;
    try {
        const init = switcher._initLidProxy();
        switcher.destroy();
        pending.resolve({connect() {throw new Error('Late proxy must not acquire handlers');}});
        let cancelled = false;
        try {await init;} catch (error) {cancelled = isCancelled(error);}
        assert(cancelled && switcher._lidProxy === null, 'Late proxy creation must not resurrect a destroyed owner');
    } finally {
        Gio.DBusProxy.new_for_bus = original;
    }
}
{
    const switcher = makeSwitcher();
    let reads = 0;
    switcher._proxy = {call: async () => {reads++; return reply(8);}};
    switcher._debouncedUpdateState();
    switcher.destroy();
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 550, () => {resolve(); return GLib.SOURCE_REMOVE;}));
    assert(reads === 0, 'Destroy removes the pending refresh source');
}
print('Cancellation and cleanup regression tests passed');

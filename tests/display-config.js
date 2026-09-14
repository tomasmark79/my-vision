// Run with: gjs -m tests/display-config.js
import GLib from 'gi://GLib';
import {ConfigIndex, matchesMonitorsConfig} from '../config.js';
import {DisplayConfigSwitcher} from '../dbus.js';

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
    await read;
    assert(!notified && switcher._currentState[0] === 1, 'No callbacks or state changes after destroy');
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
    assert(rejected && !switcher._isApplyingConfig, 'Destroy during Apply must settle the request');
    assert(switcher._updateStateTimeoutId === null, 'Destroy must not schedule another refresh');
}
print('Display configuration regression tests passed');

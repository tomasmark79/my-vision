const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function menuFixture(version = '50.0') {
    const source = readFileSync(new URL('../extension.js', `file://${__filename}`), 'utf8')
        .replace(/^import .*;?\n/gm, '')
        .replace('export default class MyVisionExtension', 'class MyVisionExtension');
    const notices = [];
    const osds = [];
    const bindings = new Map();
    class Cancelled extends Error {}
    const cancellable = {
        cancelled: false,
        cancel() {this.cancelled = true;},
        is_cancelled() {return this.cancelled;},
        set_error_if_cancelled() {if (this.cancelled) throw new Cancelled();},
    };
    const context = vm.createContext({
        GObject: {registerClass: klass => klass}, QuickSettings: {QuickMenuToggle: class {}},
        isCancelled: error => error instanceof Cancelled,
        Gio: {ThemedIcon: class {constructor(props) {Object.assign(this, props);}}},
        Config: {PACKAGE_VERSION: version},
        Meta: {KeyBindingFlags: {NONE: 0, IGNORE_AUTOREPEAT: 16}},
        Shell: {ActionMode: {NORMAL: 1}},
        Extension: class {}, Main: {
            notify: (...args) => notices.push(args),
            wm: {
                removeKeybinding: key => bindings.delete(key),
                addKeybinding: (key, settings, flags, modes, handler) => bindings.set(key, {flags, handler}),
            },
            osdWindowManager: {
                showAll: (...args) => osds.push(['showAll', ...args]),
                show: (...args) => osds.push(['show', ...args]),
            },
        }, console: {warn() {}},
        selectProfile: (profiles, id) => profiles.find(p => p.id === id) ?? profiles[0],
    });
    vm.runInContext(`${source}\nthis.Menu = DisplayConfigQuickMenuToggle;`, context);
    const menu = new context.Menu();
    let key = 'closed';
    const closed = {id: 'closed', config: ['Closed']};
    const open = {id: 'open', config: ['Open']};
    Object.assign(menu, {
        _cancellable: cancellable, _context: null, _handledContext: false, _retryCount: 0,
        _isApplyingConfig: false, _pendingProfile: null, _requestedProfile: null,
        _settings: {get_boolean: () => true},
        _store: {profiles: [closed, open], last: {}, enrich() {}, remember(key, id) {this.last[key] = id;}},
        _displayConfigSwitcher: {getPhysicalDisplayInfo: () => [], getLidState: () => key, applyProfile: async () => {}, requestStateUpdate() {}},
        _getContext: () => key,
        _updateMenu() {this._currentConfigs = key === 'closed' ? [closed] : [open];},
        _isActive: () => false,
    });
    return {menu, closed, open, notices, osds, bindings, setContext(value) {key = value;}};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};

test('own display signals do not cause repeated automatic restoration', async () => {
    const {menu} = menuFixture(); let calls = 0;
    menu._displayConfigSwitcher.applyProfile = async () => {calls++;};
    menu._onStateChanged(); await tick();
    for (let i = 0; i < 5; i++) menu._onStateChanged();
    await tick();
    assert.equal(calls, 1);
    assert.equal(menu._store.last.closed, 'closed');
});
test('lid change during apply restores the latest context without remembering the stale one', async () => {
    const {menu, setContext} = menuFixture(); const pending = deferred(); const calls = [];
    menu._displayConfigSwitcher.applyProfile = p => {calls.push(p.id); return calls.length === 1 ? pending.promise : Promise.resolve();};
    menu._onStateChanged();
    setContext('open'); menu._onStateChanged();
    pending.resolve(); await tick();
    menu._onStateChanged(); await tick();
    assert.deepEqual(calls, ['closed', 'open']);
    assert.equal(menu._store.last.closed, undefined);
    assert.equal(menu._store.last.open, 'open');
});
test('manual selection during automatic apply is queued and wins', async () => {
    const {menu, open} = menuFixture(); const pending = deferred(); const calls = [];
    menu._displayConfigSwitcher.applyProfile = p => {calls.push(p.id); return calls.length === 1 ? pending.promise : Promise.resolve();};
    menu._onStateChanged();
    await menu._onConfig(open);
    pending.resolve(); await tick();
    assert.deepEqual(calls, ['closed']);
    menu._onStateChanged(); await tick();
    assert.deepEqual(calls, ['closed', 'open']);
    assert.equal(menu._store.last.closed, 'open');
});
test('transient stale-state retries are bounded', async () => {
    const {menu, notices} = menuFixture(); let calls = 0;
    menu._displayConfigSwitcher.applyProfile = async () => {calls++; const error = new Error('changing'); error.code = 'STATE_CHANGED'; throw error;};
    for (let i = 0; i < 8; i++) {menu._onStateChanged(); await tick();}
    assert.equal(calls, 3);
    assert.equal(notices.length, 1);
    assert.deepEqual(menu._store.last, {});
});
test('disable during apply neither writes settings nor notifies', async () => {
    const {menu, notices} = menuFixture(); const pending = deferred();
    menu._displayConfigSwitcher.applyProfile = () => pending.promise;
    menu._onStateChanged(); menu._cancellable.cancel();
    menu._cancellable = null;
    pending.resolve(); await tick();
    assert.deepEqual(menu._store.last, {});
    assert.equal(notices.length, 0);
});

test('cancellation while saving cannot access released settings or UI', async () => {
    const {menu, notices} = menuFixture(); const pending = deferred();
    menu._nameDialog = {disconnect() {}, isValid: () => true, getName: () => 'Saved'};
    menu._dialogHandlerId = 1;
    menu._dialogContext = 'closed';
    menu._displayConfigSwitcher.refresh = () => pending.promise;
    const save = menu._onNameDialogClosed();
    menu._cancellable.cancel();
    menu._cancellable = null;
    menu._store = null;
    menu._displayConfigSwitcher = null;
    menu._nameDialog = null;
    pending.resolve(true);
    await save;
    assert.equal(notices.length, 0);
});

// Live A/B testing isolated the native OSD as the display-hang trigger. These
// checks prevent reintroducing that side effect; hardware verification is separate.
for (const version of ['46.0', '47.0', '48.0', '49.0', '50.0']) {
    test(`GNOME ${version}: mixed profile switches never display an OSD`, async () => {
        const {menu, closed, open, osds} = menuFixture(version);
        const both = {id: 'both', config: ['Both']};
        menu._store.profiles.push(both);
        menu._context = 'closed';
        menu._handledContext = true;
        menu._updateMenu = () => {menu._currentConfigs = [closed, open, both];};
        let active = null;
        menu._displayConfigSwitcher.applyProfile = async profile => {active = profile.id;};
        menu._isActive = profile => profile.id === active;
        const profiles = [closed, open, both];
        const order = [0, 1, 0, 1, 2, 1, 0, 1, 2, 0, 1, 0, 2, 1, 2, 1, 2, 0, 2, 0];
        for (const index of order) {
            const profile = profiles[index];
            await menu._onConfig(profile);
            menu._onStateChanged();
            assert.equal(menu._store.last.closed, profile.id, 'The selection must still be remembered');
            assert.equal(osds.length, 0, 'A confirmed switch must not trigger native OSD composition');
        }
    });
}

test('failed switches keep the remembered selection and report the failure', async () => {
    const {menu, closed, osds, notices} = menuFixture();
    menu._context = 'closed';
    menu._store.last.closed = 'previous';
    menu._displayConfigSwitcher.applyProfile = async () => {throw new Error('Unavailable mode');};
    await menu._onConfig(closed);
    menu._onStateChanged();
    assert.equal(menu._store.last.closed, 'previous');
    assert.equal(notices.length, 1);
    assert.equal(osds.length, 0);
});

test('cancellation during switch does not display an OSD or access released settings', async () => {
    const {menu, closed, osds} = menuFixture();
    const pending = deferred();
    menu._displayConfigSwitcher.applyProfile = () => pending.promise;
    const apply = menu._onConfig(closed);
    menu._cancellable.cancel();
    menu._cancellable = null;
    menu._store = null;
    pending.resolve();
    await apply;
    assert.equal(osds.length, 0);
});


test('shortcut registration suppresses keyboard autorepeat', () => {
    const {menu, bindings} = menuFixture();
    menu._updateKeyBindings();
    assert.equal(bindings.size, 2);
    for (const binding of bindings.values())
        assert.ok(binding.flags & 16, 'Holding a shortcut must not generate repeated display switches');
});

test('two shortcut presses queue successive profiles and wait for refreshed state', async () => {
    const {menu, closed, open, bindings} = menuFixture();
    const both = {id: 'both', config: ['Both']};
    menu._store.profiles.push(both);
    menu._context = 'closed';
    menu._handledContext = true;
    menu._currentConfigs = [closed, open, both];
    menu._activeConfig = closed;
    menu._updateMenu = () => {};
    const first = deferred();
    const calls = [];
    menu._displayConfigSwitcher.applyProfile = profile => {
        calls.push(profile.id);
        return calls.length === 1 ? first.promise : Promise.resolve();
    };
    menu._updateKeyBindings();
    const next = bindings.get('display-configuration-switcher-shortcut-next').handler;
    next();
    next();
    assert.deepEqual(calls, ['open']);
    first.resolve();
    await tick();
    assert.deepEqual(calls, ['open'], 'A method reply is not the refreshed monitor state');
    menu._activeConfig = open;
    menu._onStateChanged();
    await tick();
    assert.deepEqual(calls, ['open', 'both'], 'The second press advances from the first requested profile');
});

test('shortcut after apply reply still waits for state publication', async () => {
    const {menu, closed, open, bindings} = menuFixture();
    const both = {id: 'both', config: ['Both']};
    menu._store.profiles.push(both);
    menu._context = 'closed';
    menu._handledContext = true;
    menu._currentConfigs = [closed, open, both];
    menu._activeConfig = closed;
    menu._updateMenu = () => {};
    const calls = [];
    menu._displayConfigSwitcher.applyProfile = async profile => {calls.push(profile.id);};
    menu._updateKeyBindings();
    const next = bindings.get('display-configuration-switcher-shortcut-next').handler;
    next();
    await tick();
    next();
    await tick();
    assert.deepEqual(calls, ['open'], 'Do not dispatch another modeset before state publication');
    menu._activeConfig = open;
    menu._onStateChanged();
    await tick();
    assert.deepEqual(calls, ['open', 'both']);
});

test('rapid shortcut cycling follows the latest queued target', async () => {
    const {menu, closed, open, bindings} = menuFixture();
    const both = {id: 'both', config: ['Both']};
    menu._store.profiles.push(both);
    menu._context = 'closed';
    menu._handledContext = true;
    menu._currentConfigs = [closed, open, both];
    menu._activeConfig = closed;
    menu._updateMenu = () => {};
    const first = deferred();
    const calls = [];
    menu._displayConfigSwitcher.applyProfile = profile => {
        calls.push(profile.id);
        return calls.length === 1 ? first.promise : Promise.resolve();
    };
    menu._updateKeyBindings();
    const next = bindings.get('display-configuration-switcher-shortcut-next').handler;
    next(); next(); next();
    assert.deepEqual(calls, ['open']);
    first.resolve(); await tick();
    menu._activeConfig = open;
    menu._onStateChanged(); await tick();
    assert.deepEqual(calls, ['open', 'closed'], 'Three presses cycle back; only the final queued target is applied');
});

test('queued selection requests a new state read after a missed publication', async () => {
    const {menu, closed, open} = menuFixture();
    menu._context = 'closed';
    let refreshes = 0;
    const calls = [];
    menu._displayConfigSwitcher.requestStateUpdate = () => {refreshes++;};
    menu._displayConfigSwitcher.applyProfile = async profile => {calls.push(profile.id);};
    await menu._onConfig(closed);
    await menu._onConfig(open);
    assert.equal(refreshes, 1, 'A later user selection must retry the read rather than remain stuck');
    assert.deepEqual(calls, ['closed']);
    menu._onStateChanged(); await tick();
    assert.deepEqual(calls, ['closed', 'open']);
});

test('state publication drops queued selections for an old hardware context', async () => {
    const {menu, closed, open, setContext} = menuFixture();
    menu._context = 'closed';
    menu._handledContext = true;
    const calls = [];
    menu._displayConfigSwitcher.applyProfile = async profile => {calls.push(profile.id);};
    await menu._onConfig(closed);
    await menu._onConfig(closed);
    setContext('open');
    menu._onStateChanged(); await tick();
    assert.deepEqual(calls, ['closed', 'open']);
    assert.equal(menu._store.last.open, 'open');
});

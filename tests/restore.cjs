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
        Extension: class {}, Main: {
            notify: (...args) => notices.push(args),
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
        _isApplyingConfig: false, _pendingProfile: null, _pendingOsd: null,
        _store: {profiles: [closed, open], last: {}, enrich() {}, remember(key, id) {this.last[key] = id;}},
        _displayConfigSwitcher: {getPhysicalDisplayInfo: () => [], getLidState: () => key, applyProfile: async () => {}},
        _getContext: () => key,
        _updateMenu() {this._currentConfigs = key === 'closed' ? [closed] : [open];},
        _isActive: () => false,
    });
    return {menu, closed, open, notices, osds, setContext(value) {key = value;}};
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

for (const version of ['46.0', '47.0', '48.0', '49.0', '50.0']) {
    test(`GNOME ${version}: OSD follows confirmed state and uses the matching native API`, async () => {
        const {menu, closed, osds} = menuFixture(version);
        menu._context = 'closed';
        menu._isActive = () => true;
        await menu._onConfig(closed);
        assert.equal(osds.length, 0, 'Wait for the refreshed monitor state');
        menu._onStateChanged();
        assert.equal(osds.length, 1);
        const modern = Number.parseInt(version, 10) >= 49;
        assert.equal(osds[0][0], modern ? 'showAll' : 'show');
        if (!modern) assert.equal(osds[0][1], -1);
        assert.equal(osds[0][modern ? 1 : 2].name, 'video-display-symbolic');
        assert.equal(osds[0][modern ? 2 : 3], 'Closed');
        assert.equal(osds[0].at(-1), null, 'Profile OSD has no volume/brightness bar');
        menu._onStateChanged();
        assert.equal(osds.length, 1, 'Own state events must not repeat OSD');
    });
}

test('failed or unconfirmed switches do not announce success', async () => {
    const {menu, closed, osds} = menuFixture();
    menu._context = 'closed';
    menu._displayConfigSwitcher.applyProfile = async () => {throw new Error('Unavailable mode');};
    await menu._onConfig(closed);
    menu._onStateChanged();
    assert.equal(osds.length, 0);
    menu._displayConfigSwitcher.applyProfile = async () => {};
    await menu._onConfig(closed);
    menu._onStateChanged(); // _isActive returns false: fresh layout does not match.
    assert.equal(osds.length, 0);
    assert.equal(menu._pendingOsd, null);
});

test('changed monitor context discards pending OSD', async () => {
    const {menu, closed, setContext, osds} = menuFixture();
    menu._context = 'closed';
    menu._isActive = () => true;
    await menu._onConfig(closed);
    setContext('open');
    menu._showPendingOsd();
    assert.equal(osds.length, 0);
    assert.equal(menu._pendingOsd, null);
});

test('cancellation during switch cannot queue an OSD', async () => {
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
    assert.equal(menu._pendingOsd, null);
});

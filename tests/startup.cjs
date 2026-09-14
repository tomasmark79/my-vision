// Run with: node --test tests/startup.cjs
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function load(startingUp) {
    const handlers = new Map();
    const layoutManager = {
        _startingUp: startingUp,
        connect(signal, callback) {
            assert.equal(signal, 'startup-complete');
            handlers.set(1, callback);
            return 1;
        },
        disconnect(id) { handlers.delete(id); },
    };
    const source = readFileSync(new URL('../extension.js', `file://${__filename}`), 'utf8')
        .replace(/^import .*;?\n/gm, '')
        .replace('export default class MyVisionExtension', 'class MyVisionExtension');
    const context = vm.createContext({
        GObject: {registerClass: klass => klass},
        QuickSettings: {QuickMenuToggle: class {}},
        Extension: class {},
        Main: {layoutManager},
    });
    vm.runInContext(`${source}\nthis.ExtensionClass = MyVisionExtension;`, context);
    const extension = new context.ExtensionClass();
    let created = 0;
    extension._createIndicator = () => { created++; };
    return {extension, handlers, count: () => created};
}

test('initialization waits for startup-complete and only runs once', () => {
    const {extension, handlers, count} = load(true);
    extension.enable();
    assert.equal(count(), 0);
    handlers.get(1)();
    assert.equal(count(), 1);
    assert.equal(handlers.size, 0);
});

test('disable during startup disconnects the pending initialization', () => {
    const {extension, handlers, count} = load(true);
    extension.enable();
    extension.disable();
    assert.equal(count(), 0);
    assert.equal(handlers.size, 0);
});

test('enabling in a running session initializes immediately', () => {
    const {extension, handlers, count} = load(false);
    extension.enable();
    assert.equal(count(), 1);
    assert.equal(handlers.size, 0);
});

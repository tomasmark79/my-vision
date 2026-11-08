// Standalone diagnostic client. Imports no extension modules and writes no settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const destination = 'org.gnome.Mutter.DisplayConfig';
const objectPath = '/org/gnome/Mutter/DisplayConfig';
const signature = '(uua(iiduba(ssa{sv}))a{sv})';
const uuid = 'my-vision@digitalspace.name';

function call(bus, name, path, iface, method, args = null) {
    return bus.call_sync(name, path, iface, method, args, null,
        Gio.DBusCallFlags.NONE, 5000, null).recursiveUnpack();
}

function state() {
    return call(Gio.DBus.session, destination, objectPath, destination, 'GetCurrentState');
}

function properties(values) {
    const types = { 'layout-mode': 'u', 'color-mode': 'u', underscanning: 'b' };
    return Object.fromEntries(Object.entries(values).map(([key, value]) => {
        if (!(key in types))
            throw new Error(`Unsupported diagnostic property: ${key}`);
        return [key, new GLib.Variant(types[key], value)];
    }));
}

function prepare(profile, current) {
    const [, monitors] = current;
    if (monitors.length !== profile.displays.length)
        throw new Error('Connected monitor count differs from the saved test context');
    const resolved = new Map();
    const used = new Set();
    for (const expected of profile.displays) {
        const matches = monitors.filter(([id, , props]) =>
            id[1] === expected.vendor && id[2] === expected.product && id[3] === expected.serial &&
            (props['is-builtin'] === true) === expected.builtin);
        if (matches.length !== 1 || used.has(matches[0][0][0]))
            throw new Error(`Missing or ambiguous monitor: ${expected.product}`);
        used.add(matches[0][0][0]);
        resolved.set(expected.connector, matches[0]);
    }
    return profile.logical.map(([x, y, scale, transform, primary, assignments]) =>
        [x, y, scale, transform, primary, assignments.map(([connector, modeId, props]) => {
            const monitor = resolved.get(connector);
            if (!monitor)
                throw new Error(`Unknown saved connector: ${connector}`);
            const mode = monitor[1].find(m => m[0] === modeId);
            if (!mode || !mode[5].includes(scale))
                throw new Error(`Exact mode/scale unavailable: ${monitor[0][0]} ${modeId} scale ${scale}`);
            return [monitor[0][0], modeId, properties(props)];
        })]);
}

function assertLid(profile) {
    const [closed] = call(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower',
        'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', ['org.freedesktop.UPower', 'LidIsClosed']));
    if ((closed ? 'closed' : 'open') !== profile.lid)
        throw new Error('Lid condition differs from the saved test context');
}

function assertExtensionState(allowActive) {
    const [info] = call(Gio.DBus.session, 'org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
        'org.gnome.Shell.Extensions', 'GetExtensionInfo', new GLib.Variant('(s)', [uuid]));
    // Shell ExtensionState: ENABLED=1, DISABLED=2. Refuse unknown/transitional states.
    if (info.state !== 2 && !(allowActive && info.state === 1))
        throw new Error(`My Vision must be disabled for an isolated test (state ${info.state})`);
    print(JSON.stringify({ extensionState: info.state, isolated: info.state === 2 }));
}

function main() {
    const [file, target, action = '--preview', comparison] = ARGV;
    if (!file || !target || ARGV.length > 4 || !['--preview', '--verify', '--apply'].includes(action) ||
        (comparison !== undefined && comparison !== '--allow-active-extension'))
        throw new Error('Usage: gjs -m tools/direct-display.mjs CONFIG.json TARGET [--preview|--verify|--apply] [--allow-active-extension]');
    const [, bytes] = GLib.file_get_contents(file);
    const config = JSON.parse(new TextDecoder().decode(bytes));
    if (!Object.hasOwn(config, target))
        throw new Error(`Unknown target; choose ${Object.keys(config).join(', ')}`);
    const profile = config[target];
    const current = state();
    assertLid(profile);
    const logical = prepare(profile, current);
    const method = action === '--verify' ? 0 : 1;
    const parameters = new GLib.Variant(signature, [current[0], method, logical, properties(profile.properties)]);
    print(JSON.stringify({
        time: new Date().toISOString(), target, action,
        before: current[2], parameters: parameters.print(true)
    }));
    if (action === '--preview') {
        print('Preview only; no ApplyMonitorsConfig call sent.');
        return;
    }
    assertExtensionState(comparison === '--allow-active-extension');
    call(Gio.DBus.session, destination, objectPath, destination, 'ApplyMonitorsConfig', parameters);
    print(JSON.stringify({ time: new Date().toISOString(), target, reply: 'accepted', logical: state()[2] }));
    print(action === '--verify' ? 'Mutter accepted validation; no display change requested.' :
        'One temporary change requested. Physical output requires confirmation; no further switches scheduled.');
}

try {
    main();
} catch (error) {
    printerr(`${new Date().toISOString()} STOP: ${error.message}`);
    imports.system.exit(1);
}

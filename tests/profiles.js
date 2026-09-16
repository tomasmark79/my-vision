// Run with GSETTINGS_BACKEND=memory gjs -m tests/profiles.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ProfileStore, CONFIG_TYPE, duplicateProfile, sameConfiguration, mapDisplays, displayRecord, profileRequest, activeProfile, contextKey, selectProfile} from '../profiles.js';

let checks = 0;
function assert(ok, message) { checks++; if (!ok) throw new Error(message); }
function throws(fn, message) { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); }
const u = value => GLib.Variant.new_uint32(value);
const modes = [['3840x2160@144+vrr', 3840, 2160, 144, 1, [1, 1.5], {}], ['3840x2160@60', 3840, 2160, 60, 1, [1, 1.5], {}]];
const displays = [
    {id: ['DP-1', 'GBT', 'M32U', 'serial1'], displayName: 'Monitor', builtin: false, modes, supportedColorModes: [0, 1]},
    {id: ['eDP-1', 'AUO', 'Panel', 'serial2'], displayName: 'Built-in', builtin: true, modes, supportedColorModes: [0]},
];
const make = (lid = 'closed') => ({id: GLib.uuid_string_random(), lid, displays: displays.map(displayRecord),
    config: ['External', 0, [[0, 0, 1.5, 0, true, [['DP-1', modes[0][0], {'color-mode': u(0)}]]]], {'layout-mode': u(1)}, displays.map(d => [d.id[0], d.displayName])]});
const clone = profile => ({...profile, id: GLib.uuid_string_random(), displays: profile.displays.map(d => ({...d})), config: new GLib.Variant(CONFIG_TYPE, profile.config).deepUnpack()});
const original = make();
assert(duplicateProfile(original, clone(original)), 'Exact duplicate');
for (const mutate of [
    p => p.config[2][0][5][0][1] = modes[1][0],
    p => p.config[2][0][5][0][1] = '1920x1080@60',
    p => p.config[2][0][5][0][0] = 'eDP-1',
    p => p.config[2][0][5][0][2]['color-mode'] = u(1),
    p => p.config[3]['layout-mode'] = u(2),
    p => p.config[2][0][2] = 1,
    p => p.config[2][0][3] = 1,
    p => p.config[2][0][0] = 100,
    p => p.config[2][0][4] = false,
    p => p.lid = 'open',
]) {
    const changed = clone(original); mutate(changed);
    assert(!duplicateProfile(original, changed), 'Distinct settings must survive saving');
}
const swapped = clone(original);
swapped.displays[0].connector = 'DP-9';
swapped.displays.reverse();
swapped.config[2][0][5][0][0] = 'DP-9';
assert(duplicateProfile(original, swapped), 'Port changes and enumeration order are not new profiles');
const renamed = clone(original); renamed.displays[0].name = 'Localized monitor name';
assert(duplicateProfile(original, renamed), 'Hardware identity survives locale changes');
const reordered = clone(original);
reordered.config[2][0][5][0][2] = {'underscanning': GLib.Variant.new_boolean(false), 'color-mode': u(0)};
const reordered2 = clone(reordered);
reordered2.config[2][0][5][0][2] = {'color-mode': u(0), 'underscanning': GLib.Variant.new_boolean(false)};
assert(duplicateProfile(reordered, reordered2), 'Dictionary ordering is irrelevant');
const secondMonitor = {...original.displays[0], connector: 'DP-2', serial: 'different'};
assert(mapDisplays([original.displays[0], secondMonitor], [secondMonitor, original.displays[0]]).size === 2, 'Same model with different serials is unambiguous');
throws(() => mapDisplays([{connector: 'old', name: 'Monitor'}], [original.displays[0], secondMonitor]), 'Ambiguous legacy names must be refused');
throws(() => mapDisplays(original.displays, [original.displays[0], {...original.displays[0], connector: 'DP-3'}]), 'Missing/ambiguous hardware must be refused');
assert(profileRequest(original, displays, 'closed')[0][5][0][0] === 'DP-1', 'Closed lid allows external-only profile despite attached internal panel');
const internal = make('any'); internal.config[2][0][5][0][0] = 'eDP-1';
throws(() => profileRequest(internal, displays, 'closed'), 'Internal panel cannot be activated with lid closed');
assert(profileRequest(internal, displays, 'open').length === 1, 'Open lid allows internal panel');
throws(() => profileRequest(original, displays, 'open'), 'Closed-only profile is hidden when open');
throws(() => profileRequest(original, displays, 'unknown'), 'Unknown lid must not be assumed open');
const unsupported = clone(original); unsupported.config[2][0][5][0][1] = 'missing-mode';
throws(() => profileRequest(unsupported, displays, 'closed'), 'Unavailable modes must be refused');
unsupported.config[2][0][5][0][1] = modes[0][0]; unsupported.config[2][0][2] = 1.25;
throws(() => profileRequest(unsupported, displays, 'closed'), 'Unavailable scale must be refused');
unsupported.config[2][0][2] = 1.5; unsupported.config[2][0][5][0][2]['color-mode'] = u(10);
throws(() => profileRequest(unsupported, displays, 'closed'), 'Unavailable color mode must be refused');
assert(activeProfile(original, displays, 'closed', original.config), 'Active profile recognized');
assert(contextKey(original.displays, 'closed') === contextKey(swapped.displays, 'closed'), 'Context survives port change');
assert(contextKey(original.displays, 'closed') !== contextKey(original.displays, 'open'), 'Context distinguishes lid state');
const open = make('open'); const shared = make('any');
assert(selectProfile([shared, open], null, shared.id, 'open', () => false).id === open.id, 'Specific lid preference beats legacy fallback');
assert(selectProfile([shared, open], shared.id, null, 'open', () => false).id === shared.id, 'Explicit remembered selection has priority');

// Same active layout, different connected hardware: two valid, exclusive profiles.
const dockedBuiltin = make('open');
dockedBuiltin.config[2][0][5][0][0] = 'eDP-1';
const standaloneBuiltin = clone(dockedBuiltin);
standaloneBuiltin.displays = standaloneBuiltin.displays.filter(d => d.builtin);
standaloneBuiltin.config[4] = [['eDP-1', 'Built-in']];
const builtinOnly = [displays[1]];
assert(!duplicateProfile(dockedBuiltin, standaloneBuiltin), 'Docked and standalone BuiltIn are distinct profiles');
assert(profileRequest(standaloneBuiltin, builtinOnly, 'open').length === 1, 'Standalone BuiltIn is available without external hardware');
throws(() => profileRequest(dockedBuiltin, builtinOnly, 'open'), 'Docked BuiltIn is hidden without its external monitor');
throws(() => profileRequest(standaloneBuiltin, displays, 'open'), 'Standalone BuiltIn is hidden when an external monitor is attached');
assert(profileRequest(dockedBuiltin, displays, 'open').length === 1, 'Docked BuiltIn remains available with its external monitor disabled');
const anotherExternal = [{...displays[0], id: ['DP-1', 'GBT', 'M32U', 'another-serial']}, displays[1]];
throws(() => profileRequest(dockedBuiltin, anotherExternal, 'open'), 'Equal monitor counts cannot substitute another physical monitor');
const differentPorts = [displays[1], {...displays[0], id: ['DP-9', ...displays[0].id.slice(1)]}];
assert(profileRequest(dockedBuiltin, differentPorts, 'open').length === 1, 'Connector renumbering and order do not change availability');
assert(!activeProfile(standaloneBuiltin, displays, 'open', dockedBuiltin.config), 'Identical active layout cannot bypass the hardware context');
const candidates = [standaloneBuiltin, dockedBuiltin];
const availableFor = hardware => candidates.filter(p => {
    try {profileRequest(p, hardware, 'open'); return true;} catch {return false;}
});
assert(availableFor(builtinOnly).length === 1 && availableFor(builtinOnly)[0].id === standaloneBuiltin.id,
    'Undocked menu and shortcut candidates contain only standalone BuiltIn');
assert(availableFor(displays).length === 1 && availableFor(displays)[0].id === dockedBuiltin.id,
    'Docked menu and shortcut candidates contain only docked BuiltIn');
assert(selectProfile(availableFor(builtinOnly), dockedBuiltin.id, dockedBuiltin.id, 'open', () => true).id === standaloneBuiltin.id,
    'Remembered and legacy choices cannot restore a profile from another context');
assert(selectProfile(availableFor(anotherExternal), null, dockedBuiltin.id, 'open', () => true) === null,
    'No fallback to a profile for different connected hardware');

const source = Gio.SettingsSchemaSource.new_from_directory(GLib.build_filenamev([GLib.get_current_dir(), 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.my-vision', false)});
if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory') throw new Error('Tests require memory settings backend');
settings.set_value('configs', new GLib.Variant('a' + CONFIG_TYPE, [original.config, open.config]));
settings.set_uint('last-config-index', 1);
const legacy = settings.get_value('configs').print(true);
const store = new ProfileStore(settings);
assert(store.profiles.length === 2 && store.profiles.every(p => p.lid === 'any'), 'Migration preserves all profiles with unknown historical lid state');
assert(store.legacyId === store.profiles[1].id, 'Migration preserves last selection');
assert(settings.get_value('configs').print(true) === legacy, 'Legacy backup remains byte-for-byte unchanged');
store.enrich(displays);
assert(store.profiles[0].displays[0].serial === 'serial1', 'Legacy identity enriched from unique live match');
const saved = store.add(original);
const duplicate = clone(original); duplicate.config[0] = 'Must not overwrite name';
assert(store.add(duplicate).id === saved.id && saved.config[0] === 'External', 'Duplicate save neither overwrites nor renames');
const savedOpen = store.add(open);
assert(savedOpen.id !== saved.id, 'Open and closed variants are independently saved');
store.remember('closed-key', saved.id); store.remember('open-key', savedOpen.id);
const reopened = new ProfileStore(settings);
assert(reopened.profiles.some(p => p.id === saved.id && sameConfiguration(p, original)), 'Versioned storage round-trip retains modes, properties and identity');
reopened.profiles.reverse(); reopened.save();
assert(new ProfileStore(settings).last['closed-key'] === saved.id, 'Reordering cannot change selection');
assert(!reopened.setLid(savedOpen.id, 'closed'), 'Changing scope cannot introduce a duplicate');
reopened.remove(saved.id);
assert(!('closed-key' in reopened.last) && reopened.last['open-key'] === savedOpen.id, 'Delete cleans only references to deleted profile');
assert(settings.get_value('configs').print(true) === legacy, 'Edits preserve original migration backup');
const firstBuiltin = reopened.add(standaloneBuiltin);
const secondBuiltin = reopened.add(dockedBuiltin);
assert(firstBuiltin.id !== secondBuiltin.id, 'Saving both BuiltIn contexts preserves two profiles');
assert(reopened.add(clone(standaloneBuiltin)).id === firstBuiltin.id, 'Saving the same standalone context still deduplicates');
print(`${checks} profile regression checks passed`);

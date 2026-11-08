// Run with gjs -m tests/profile-backup.js; no settings or live displays are used.
import GLib from 'gi://GLib';
import { CONFIG_TYPE, profileRequest } from '../profiles.js';
import { MAX_BACKUP_BYTES, exportProfiles, parseProfileBackup, mergeProfiles } from '../profile-backup.js';

let checks = 0;
function assert(ok, message) { checks++; if (!ok) throw new Error(message); }
function throws(fn, message) { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); }
const variant = config => new GLib.Variant(CONFIG_TYPE, config).print(true);
const make = (id = 'original') => ({
    id, lid: 'open',
    displays: [
        { connector: 'eDP-1', name: 'Built-in', vendor: 'AUO', product: 'Panel', serial: 'internal', builtin: true },
        { connector: 'DP-1', name: 'External', vendor: 'GBT', product: 'M32U', serial: 'external', builtin: false },
    ],
    config: ['Built-in with dock', 23, [[0, 0, 1.5, 0, true, [['eDP-1', '3840x2160@144+vrr', {
        'color-mode': new GLib.Variant('u', 1), 'underscanning': new GLib.Variant('b', false),
        'future-property': new GLib.Variant('(sax)', ['nested', [1, 2]]),
    }]]]], { 'layout-mode': new GLib.Variant('u', 1), 'future-global': new GLib.Variant('a{sv}', { key: new GLib.Variant('as', ['a', 'b']) }) },
    [['eDP-1', 'Built-in'], ['DP-1', 'External']]],
});
const clone = profile => parseProfileBackup(exportProfiles([profile]))[0];
const original = make();
const text = exportProfiles([original]);
const envelope = JSON.parse(text);
assert(envelope.format === 'my-vision-profiles' && envelope.version === 1, 'Portable format has a versioned discriminator');
const restored = parseProfileBackup(text)[0];
assert(variant(restored.config) === variant(original.config), 'Every typed property, hash, mode, VRR and layout survives exactly');
assert(JSON.stringify(restored.displays) === JSON.stringify(original.displays), 'Disabled monitor identity survives');
assert(restored.id === original.id && restored.lid === original.lid, 'Stable ID and lid scope survive');
assert(restored.config[2][0][5][0][2]['future-property'].get_type_string() === '(sax)', 'Unknown typed properties remain typed');
assert(parseProfileBackup(exportProfiles([])).length === 0, 'Empty collections can be backed up');
const unnamed = make('unnamed');
unnamed.displays[1].name = '';
unnamed.config[4][1][1] = '';
assert(clone(unnamed).displays[1].serial === 'external', 'Missing human labels do not discard hardware identity');
unnamed.displays[1].vendor = ''; unnamed.displays[1].product = ''; unnamed.displays[1].serial = '';
assert(clone(unnamed).displays[1].name === '', 'Unidentifiable legacy monitors can still be backed up without substitution');
const futureColor = make('future-color');
futureColor.config[2][0][5][0][2]['color-mode'] = new GLib.Variant('u', 123);
assert(clone(futureColor).config[2][0][5][0][2]['color-mode'].get_uint32() === 123, 'Future color mode values remain available for runtime validation');
const physicalLayout = make('physical-layout');
physicalLayout.config[3]['layout-mode'] = new GLib.Variant('u', 2);
assert(clone(physicalLayout).config[3]['layout-mode'].get_uint32() === 2, 'Physical layout mode remains supported');
const absentProperties = make('absent-properties');
absentProperties.config[3] = {}; absentProperties.config[2][0][5][0][2] = {};
assert(clone(absentProperties).id === 'absent-properties', 'Optional known properties may be absent');

const before = exportProfiles([original]);
const renumbered = clone(original);
renumbered.id = 'renumbered';
renumbered.config[0] = 'A different name';
renumbered.displays[1].connector = 'DP-9';
renumbered.displays.reverse();
renumbered.config[4][1][0] = 'DP-9';
renumbered.config[4].reverse();
const duplicates = mergeProfiles([original], [renumbered]);
assert(duplicates.added === 0 && duplicates.skipped === 1 && duplicates.profiles.length === 1, 'Connector renumbering and enumeration do not create duplicates');
assert(duplicates.profiles[0] === original, 'Existing objects are preserved');

const changed = clone(original);
changed.config[2][0][5][0][1] = '3840x2160@60';
const incomingBefore = exportProfiles([changed]);
const collision = mergeProfiles([original], [changed]);
assert(collision.added === 1 && collision.skipped === 0, 'Different refresh rates are not duplicates');
assert(collision.profiles[0].id === 'original' && collision.profiles[1].id !== 'original', 'Only the colliding imported ID changes');
assert(GLib.uuid_string_is_valid(collision.profiles[1].id), 'Collision creates a UUID');
assert(exportProfiles([original]) === before && exportProfiles([changed]) === incomingBefore, 'Merge changes neither input');
const unique = clone(changed); unique.id = 'unique-id';
assert(mergeProfiles([original], [unique]).profiles[1].id === 'unique-id', 'Noncolliding IDs are preserved');
const another = clone(unique); another.id = 'another-id';
const within = mergeProfiles([], [unique, another]);
assert(within.added === 1 && within.skipped === 1, 'Duplicates inside one import are skipped');

const standalone = clone(original);
standalone.id = 'standalone';
standalone.displays = standalone.displays.filter(d => d.builtin);
standalone.config[4] = [['eDP-1', 'Built-in']];
assert(mergeProfiles([original], [standalone]).added === 1, 'Disabled external hardware distinguishes docked and standalone profiles');
const closed = clone(original); closed.id = 'closed'; closed.lid = 'closed';
closed.config[2][0][5][0][0] = 'DP-1';
assert(mergeProfiles([original], [closed]).added === 1, 'Lid conditions and active assignments remain distinct');

const offline = clone(original);
offline.config[2][0][5][0][1] = 'offline-mode@777+vrr';
const offlineRoundTrip = clone(offline);
assert(offlineRoundTrip.config[2][0][5][0][1] === 'offline-mode@777+vrr', 'Offline import never substitutes a mode or rate');
const live = original.displays.map(d => ({ id: [d.connector, d.vendor, d.product, d.serial], displayName: d.name, builtin: d.builtin,
    modes: [['3840x2160@60', 3840, 2160, 60, 1, [1.5], {}]] }));
throws(() => profileRequest(offlineRoundTrip, live, 'open'), 'Unavailable modes are rejected only when applying');

function invalid(mutate, message) {
    const data = JSON.parse(text);
    mutate(data);
    throws(() => parseProfileBackup(JSON.stringify(data)), message);
}
throws(() => parseProfileBackup('{broken'), 'Malformed JSON is rejected');
throws(() => parseProfileBackup(' '.repeat(1024 * 1024 + 1)), 'Excessive bytes are rejected');
throws(() => parseProfileBackup(JSON.stringify({ ...envelope, extra: 'é'.repeat(MAX_BACKUP_BYTES / 2) })), 'The total size limit counts UTF-8 bytes');
throws(() => parseProfileBackup(null), 'Missing text is rejected');
throws(() => parseProfileBackup('null'), 'A null envelope is rejected');
invalid(d => d.version = 2, 'Unsupported versions are rejected');
invalid(d => d.format = 'other-application', 'Other formats are rejected');
invalid(d => d.profiles = {}, 'Profiles must be an array');
invalid(d => d.profiles = Array(1001).fill(d.profiles[0]), 'Profile count is limited');
invalid(d => d.profiles.push(d.profiles[0]), 'Duplicate incoming IDs are rejected');
invalid(d => d.profiles[0].id = '', 'Empty IDs are rejected');
invalid(d => d.profiles[0].lid = 'unknown', 'Unknown lid scopes are rejected');
invalid(d => d.profiles[0].displays[1].connector = 'eDP-1', 'Duplicate hardware connectors are rejected');
invalid(d => d.profiles[0].displays[0].serial = 42, 'Hardware identity strings are validated');
invalid(d => d.profiles[0].displays[0].builtin = 'yes', 'Builtin identity is boolean');
invalid(d => d.profiles[0].config = 'not a variant', 'Malformed configuration variants are rejected');
invalid(d => d.profiles[0].config = ' '.repeat(256 * 1024 + 1), 'Configuration size is limited');
for (const [mutate, message] of [
    [p => p.config[4].pop(), 'Physical context must include disabled displays'],
    [p => p.config[4][1][0] = 'eDP-1', 'Physical config connectors are unique'],
    [p => p.config[2][0][5][0][0] = 'unknown', 'Active monitors must exist in physical context'],
    [p => p.config[2][0][5].push(p.config[2][0][5][0]), 'Active monitor assignment is unique'],
    [p => p.config[2][0][5] = [], 'Logical monitors cannot be empty'],
    [p => p.config[2] = [], 'At least one logical monitor is required'],
    [p => p.config[2][0][2] = 0, 'Scale must be positive'],
    [p => p.config[2][0][2] = Infinity, 'Scale must be finite'],
    [p => p.config[2][0][2] = NaN, 'Scale must be a number'],
    [p => p.config[2][0][3] = 8, 'Transform must be in range'],
    [p => p.config[2][0][4] = false, 'Exactly one primary monitor is required'],
    [p => p.config[2].push([1920, 0, 1, 0, true, [['DP-1', '1920x1080@60', {}]]]), 'Multiple primary logical monitors are rejected'],
    [p => p.config[2][0][5][0][1] = '', 'Mode must be a nonempty string'],
    [p => p.config[3]['layout-mode'] = new GLib.Variant('s', '1'), 'Layout mode cannot be a string'],
    [p => p.config[3]['layout-mode'] = new GLib.Variant('i', 1), 'Layout mode requires an unsigned integer'],
    [p => p.config[3]['layout-mode'] = new GLib.Variant('u', 0), 'Layout mode zero is invalid'],
    [p => p.config[3]['layout-mode'] = new GLib.Variant('u', 3), 'Layout mode must be logical or physical'],
    [p => p.config[2][0][5][0][2].underscanning = new GLib.Variant('s', 'false'), 'Underscanning requires a boolean'],
    [p => p.config[2][0][5][0][2]['color-mode'] = new GLib.Variant('s', '1'), 'Color mode cannot be a string'],
    [p => p.config[2][0][5][0][2]['color-mode'] = new GLib.Variant('i', 1), 'Color mode requires an unsigned integer'],
]) {
    const bad = clone(original); mutate(bad);
    const data = JSON.parse(text); data.profiles[0].config = variant(bad.config);
    throws(() => parseProfileBackup(JSON.stringify(data)), message);
}
const corrupt = JSON.parse(exportProfiles([original, unique]));
corrupt.profiles[1].config = 'corrupt later configuration';
throws(() => mergeProfiles([original], parseProfileBackup(JSON.stringify(corrupt))), 'Later corruption aborts the whole import');
const corruptHydrated = clone(unique); corruptHydrated.id = 'invalid-hydrated'; corruptHydrated.config[2][0][2] = -1;
throws(() => mergeProfiles([original], [unique, corruptHydrated]), 'Direct merge validates all imported profiles');
const badProperty = clone(unique); badProperty.id = 'invalid-property';
badProperty.config[2][0][5][0][2].underscanning = new GLib.Variant('u', 1);
const laterProperty = JSON.parse(exportProfiles([unique]));
laterProperty.profiles.push({ ...badProperty, config: variant(badProperty.config) });
throws(() => mergeProfiles([original], parseProfileBackup(JSON.stringify(laterProperty))), 'An invalid property in a later profile aborts the whole file import');
throws(() => mergeProfiles([original], [unique, badProperty]), 'An invalid later property also aborts direct merge');
assert(exportProfiles([original]) === before, 'Failed imports leave existing profiles unchanged');
print(`${checks} profile backup checks passed`);

// Run tests/preferences.sh after building the ZIP. Uses real GTK and memory settings.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ProfileStore, displayRecord, CONFIG_TYPE } from '../profiles.js';
import { exportProfiles, parseProfileBackup } from '../profile-backup.js';
import { DisplayConfigSwitcher } from '../dbus.js';

function assert(ok, message) { if (!ok) throw new Error(message); }
assert(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'Preferences tests require isolated memory settings');
Adw.init();
const directory = ARGV[0];
const decoder = new TextDecoder();
const source = Gio.SettingsSchemaSource.new_from_directory(`${GLib.get_current_dir()}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({ settings_schema: source.lookup('org.gnome.shell.extensions.my-vision', false) });
const display = { id: ['DP-9', 'GBT', 'M32U', 'external'], displayName: 'External', builtin: false,
    modes: [['3840x2160@120', 3840, 2160, 120, 1, [1, 1.5], {}]] };
const profile = { id: 'existing', lid: 'open', displays: [displayRecord(display)],
    config: ['External', 0, [[0, 0, 1.5, 0, true, [['DP-9', '3840x2160@120', {}]]]], {}, [['DP-9', 'External']]],
};
const store = new ProfileStore(settings);
store.add(profile);
store.remember('current-context', 'existing');
const legacy = settings.get_value('configs').print(true);
const tick = () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_LOW, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function until(predicate) {
    const deadline = GLib.get_monotonic_time() + 5_000_000;
    while (!predicate()) {
        if (GLib.get_monotonic_time() > deadline) throw new Error('Timed out waiting for preferences operation');
        await tick();
    }
}
const switchers = [];
// Isolate D-Bus transport; use the real backend's state parsing and destruction.
DisplayConfigSwitcher.prototype._initProxy = async function () {
    const cancellable = this._cancellable;
    switchers.push(this);
    await Promise.resolve();
    cancellable.set_error_if_cancelled();
    this._lidState = 'open';
    this._currentState = [1, [[display.id, display.modes, { 'display-name': display.displayName }]], [], {}];
    this._onStateChangedCallback();
};
DisplayConfigSwitcher.prototype.applyProfile = () => { throw new Error('Preferences must never apply a profile'); };

// Replace only the GNOME preferences host; all project modules and widgets are real.
globalThis.testSettings = settings;
globalThis.testDirectory = directory;
let code = decoder.decode(GLib.file_get_contents('prefs.js')[1]);
code = code.replace(/import \{ ExtensionPreferences, gettext as _ \} from .*;/,
    'class ExtensionPreferences { get path() { return globalThis.testDirectory; } getSettings() { return globalThis.testSettings; } } const _ = text => text;');
code = code.replace(/from '\.\/(.*?)'/g, (_, path) => `from '${Gio.File.new_for_path(`${GLib.get_current_dir()}/${path}`).get_uri()}'`);
GLib.file_set_contents(`${directory}/test-prefs.js`, code);
const { default: Preferences } = await import(Gio.File.new_for_path(`${directory}/test-prefs.js`).get_uri());

function widgets(root) {
    const result = [root];
    for (let child = root.get_first_child(); child; child = child.get_next_sibling())
        result.push(...widgets(child));
    return result;
}
function makeWindow() {
    const window = new Adw.PreferencesWindow({ default_width: 800, default_height: 700 });
    const notices = [];
    window.add_toast = toast => notices.push(toast.title);
    new Preferences().fillPreferencesWindow(window);
    window.present();
    const findButton = label => widgets(window).find(w => w instanceof Gtk.Button && w.label === label);
    return { window, notices, exportButton: findButton('Export…'), importButton: findButton('Import…') };
}
const file = Gio.File.new_for_path(`${directory}/backup.json`);
Gio._promisify(Gtk.FileDialog.prototype, 'open');
Gio._promisify(Gtk.FileDialog.prototype, 'save');
Gtk.FileDialog.prototype.open = async () => file;
Gtk.FileDialog.prototype.save = async () => file;

const first = makeWindow();
const osdRow = widgets(first.window).find(w => w instanceof Adw.ActionRow && w.title === 'Show Profile OSD');
assert(osdRow, 'Preferences must offer an OSD toggle');
const osdSwitch = widgets(osdRow).find(w => w instanceof Gtk.Switch);
assert(osdSwitch.active, 'OSD stays enabled by default');
osdSwitch.active = false;
assert(!settings.get_boolean('show-profile-osd'), 'OSD toggle must persist its setting');
settings.set_boolean('show-profile-osd', true);
assert(osdSwitch.active, 'OSD toggle must reflect external setting changes');
await until(() => widgets(first.window).some(w => w instanceof Adw.EntryRow && w.title.includes('Available for')));
let row = widgets(first.window).find(w => w instanceof Adw.EntryRow && w.text === 'External');
assert(row.infoLabel.label.includes('3840 × 2160 · 120 Hz') && row.infoLabel.label.includes('150%'), 'Preferences must expose readable saved monitor settings');
assert(!row.use_markup && !row.infoLabel.use_markup, 'Monitor names and import errors must be displayed as literal text');
row.text = 'Unsaved rename';
switchers[0]._lidState = 'closed';
switchers[0]._onStateChangedCallback();
assert(row.title.includes('Unavailable') && /lid/i.test(row.title), 'Live lid updates must explain profile unavailability');
assert(row.text === 'Unsaved rename', 'Live state updates must preserve an in-progress rename');

first.exportButton.emit('clicked');
await until(() => first.exportButton.sensitive);
assert(first.notices.some(n => n === 'Profiles exported.'), 'Export must report success');
assert(parseProfileBackup(decoder.decode(GLib.file_get_contents(file.get_path())[1]))[0].id === 'existing', 'UI export writes actual stored profiles');
first.importButton.emit('clicked');
await until(() => first.importButton.sensitive);
assert(new ProfileStore(settings).profiles.length === 1 && first.notices.at(-1).includes('Duplicates skipped: 1'), 'UI import skips duplicates');

const extra = { ...profile, id: 'new', lid: 'closed', config: [...profile.config] };
extra.config[0] = 'Closed profile';
GLib.file_set_contents(file.get_path(), exportProfiles([extra]));
first.importButton.emit('clicked');
await until(() => first.importButton.sensitive);
const imported = new ProfileStore(settings);
assert(imported.profiles.length === 2 && imported.last['current-context'] === 'existing', 'UI import appends and preserves current selections');
assert(settings.get_value('configs').print(true) === legacy, 'UI import preserves legacy backup settings');

const before = settings.get_string('profiles-v2');
GLib.file_set_contents(file.get_path(), '{bad json');
first.importButton.emit('clicked');
await until(() => first.importButton.sensitive);
assert(settings.get_string('profiles-v2') === before && first.notices.at(-1).includes('Could not import'), 'Invalid import must not change settings');

// A valid first entry must not be saved when a later entry contains invalid typed properties.
const fresh = { ...profile, id: 'fresh', lid: 'any' };
const invalid = JSON.parse(exportProfiles([fresh, extra]));
const badConfig = new GLib.Variant(CONFIG_TYPE, extra.config).deepUnpack();
badConfig[3]['layout-mode'] = new GLib.Variant('s', 'wrong');
invalid.profiles[1].config = new GLib.Variant(CONFIG_TYPE, badConfig).print(true);
GLib.file_set_contents(file.get_path(), JSON.stringify(invalid));
first.importButton.emit('clicked');
await until(() => first.importButton.sensitive);
assert(settings.get_string('profiles-v2') === before && first.notices.at(-1).includes('Could not import'),
    'A later invalid property must abort the entire import before settings change');

// Resolve the native chooser, then close before its JS continuation runs.
let resolveChooser;
Gtk.FileDialog.prototype.open = () => new Promise(resolve => { resolveChooser = resolve; });
const noticeCount = first.notices.length;
first.importButton.emit('clicked');
resolveChooser(file);
first.window.close();
await tick();
assert(settings.get_string('profiles-v2') === before && first.notices.length === noticeCount, 'Late chooser completion cannot write settings or notify after closing');
assert(switchers[0]._cancellable === null && switchers[0]._onStateChangedCallback === null, 'Closing preferences releases live monitor resources');

// A second window also proves that resource/type registration survives reopening.
const second = makeWindow();
await tick();
Gtk.FileDialog.prototype.open = async () => file;
const originalRead = Gio.File.prototype.read_async;
Gio._promisify(Gio.File.prototype, 'read_async');
let resolveRead;
let readStarted = false;
const input = new Gio.MemoryInputStream();
input.add_bytes(new GLib.Bytes(new TextEncoder().encode(exportProfiles([extra]))));
Gio.File.prototype.read_async = () => { readStarted = true; return new Promise(resolve => { resolveRead = resolve; }); };
second.importButton.emit('clicked');
await until(() => readStarted);
resolveRead(input);
second.window.close();
await until(() => input.is_closed());
await tick();
assert(settings.get_string('profiles-v2') === before && second.notices.length === 0, 'Late file read cannot import or notify after closing');
Gio.File.prototype.read_async = originalRead;

// A completed write may still have its JS continuation queued when the window closes.
const third = makeWindow();
await tick();
let resolveWrite;
let writeStarted = false;
const originalWrite = Gio.File.prototype.replace_contents_bytes_async;
Gio.File.prototype.replace_contents_bytes_async = () => {
    writeStarted = true;
    return new Promise(resolve => { resolveWrite = resolve; });
};
third.exportButton.emit('clicked');
await until(() => writeStarted);
resolveWrite([true, 'etag']);
third.window.close();
await tick();
assert(third.notices.length === 0 && settings.get_string('profiles-v2') === before,
    'Late export completion must not notify or touch released settings');
Gio.File.prototype.replace_contents_bytes_async = originalWrite;
print('GTK preferences: live availability, details, backup actions, reopen and cancellation checks passed');

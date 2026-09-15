// Read-only smoke test. Never calls ApplyMonitorsConfig or writes settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DisplayConfigSwitcher} from '../dbus.js';
import {ProfileStore, profileRequest, activeProfile} from '../profiles.js';
const source = Gio.SettingsSchemaSource.new_from_directory(GLib.build_filenamev([GLib.get_current_dir(), 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.my-vision', false)});
const fake = {get_string: () => '', get_value: () => settings.get_value('configs'), get_uint: () => settings.get_uint('last-config-index'), set_string() {}};
const store = new ProfileStore(fake);
await new Promise((resolve, reject) => {
    const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
        switcher.destroy(); reject(new Error('Timed out waiting for live state')); return GLib.SOURCE_REMOVE;
    });
    const switcher = new DisplayConfigSwitcher(async () => {
        GLib.source_remove(timeout);
        try {
            if (!await switcher.refresh()) throw new Error('Live state changed during smoke test');
            const displays = switcher.getPhysicalDisplayInfo();
            const lid = switcher.getLidState();
            store.enrich(displays);
            print(`Lid: ${lid}; monitors: ${displays.map(d => `${d.displayName} (built-in=${d.builtin})`).join(', ')}`);
            if (lid === 'unknown') throw new Error('Lid state was not detected');
            for (const profile of store.profiles) {
                try {
                    profileRequest(profile, displays, lid);
                    print(`${profile.config[0]}: available; active=${activeProfile(profile, displays, lid, switcher.getMonitorsConfig())}`);
                } catch (error) {
                    print(`${profile.config[0]}: unavailable (${error.message})`);
                }
            }
            resolve();
        } catch (error) { reject(error); }
        finally { switcher.destroy(); }
    });
});

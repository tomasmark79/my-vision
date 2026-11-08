// Run with: gjs -m tests/profile-files.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { exportProfiles, MAX_BACKUP_BYTES } from '../profile-backup.js';

function assert(ok, message) { if (!ok) throw new Error(message); }
assert(GLib.file_test('profile-files.js', GLib.FileTest.EXISTS), 'Profile backup file operations must exist');
const { readProfileBackup, writeProfileBackup } = await import('../profile-files.js');
const directory = GLib.dir_make_tmp('my-vision-backup-tests-XXXXXX');
const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'profiles.json']));
const profile = { id: 'file-test', lid: 'open',
    displays: [{ connector: 'DP-1', name: 'External', vendor: 'GBT', product: 'M32U', serial: '1', builtin: false }],
    config: ['External', 0, [[0, 0, 1.5, 0, true, [['DP-1', '3840x2160@120', {}]]]], {}, [['DP-1', 'External']]],
};
try {
    const cancellable = new Gio.Cancellable();
    await writeProfileBackup(file, exportProfiles([profile]), cancellable);
    const imported = await readProfileBackup(file, cancellable);
    assert(imported.length === 1 && imported[0].config[2][0][5][0][1] === '3840x2160@120', 'File round-trip preserves the saved mode');
    GLib.file_set_contents(file.get_path(), 'x'.repeat(MAX_BACKUP_BYTES + 1));
    let rejected = false;
    try { await readProfileBackup(file, cancellable); } catch (error) { rejected = /large/i.test(error.message); }
    assert(rejected, 'Oversize file must be rejected before parsing');
    const cancelled = new Gio.Cancellable();
    cancelled.cancel();
    rejected = false;
    try { await writeProfileBackup(file, 'must not write', cancelled); } catch (error) {
        rejected = error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED);
    }
    assert(rejected && file.query_info('standard::size', 0, null).get_size() === MAX_BACKUP_BYTES + 1,
        'Cancellation must preserve the existing backup file');
    rejected = false;
    try { await readProfileBackup(file, cancelled); } catch (error) {
        rejected = error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED);
    }
    assert(rejected, 'Cancelled import must not return profiles');
} finally {
    file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
print('Backup file round-trip, size limit and cancellation checks passed');

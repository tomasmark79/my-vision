// Run with: gjs -m tests/profile-details.js
import GLib from 'gi://GLib';
import { displayRecord } from '../profiles.js';

let checks = 0;
function assert(ok, message) { checks++; if (!ok) throw new Error(message); }
const moduleFile = GLib.build_filenamev([GLib.get_current_dir(), 'profile-details.js']);
assert(GLib.file_test(moduleFile, GLib.FileTest.EXISTS), 'Profile details must be available to preferences');
const { profileStatus, profileMonitorDetails, formatProfileDetails } = await import('../profile-details.js');
const displays = [
    { id: ['DP-9', 'GBT', 'M32U', 'external'], displayName: 'External', builtin: false,
        modes: [['opaque-mode', 3840, 2160, 119.9999, 1, [1, 1.5], {}]] },
    { id: ['eDP-1', 'AUO', 'Panel', 'internal'], displayName: 'Built-in', builtin: true, modes: [] },
];
const profile = {
    id: 'test', lid: 'open',
    displays: displays.map(d => ({ ...displayRecord(d), connector: d.builtin ? 'eDP-1' : 'DP-1' })),
    config: ['Name does not describe mode', 0,
        [[0, 0, 1.5, 0, true, [['DP-1', 'opaque-mode', {}]]]], {}, [['DP-1', 'External'], ['eDP-1', 'Built-in']]],
};
assert(profileStatus(profile, null, 'unknown').available === false, 'Pending live state cannot claim availability');
assert(profileStatus(profile, displays, 'open').available, 'Same hardware on a new connector remains available');
assert(/lid/i.test(profileStatus(profile, displays, 'closed').reason), 'Explain a mismatched lid condition');
assert(/connected monitors/i.test(profileStatus(profile, displays.slice(0, 1), 'open').reason), 'Disabled monitors still determine availability');
const changed = [{ ...displays[0], id: ['DP-9', 'GBT', 'M32U', 'other'] }, displays[1]];
assert(!profileStatus(profile, changed, 'open').available, 'Equal monitor counts cannot substitute hardware');
const details = profileMonitorDetails(profile, displays);
assert(details.length === 2 && details[0].enabled && !details[1].enabled, 'Show enabled and disabled physical monitors');
assert(details[0].width === 3840 && details[0].height === 2160 && details[0].refresh === 119.9999,
    'Read the exact saved mode from the matching physical monitor despite port renumbering');
assert(details[0].scale === 1.5 && details[0].primary && details[0].mode === 'opaque-mode', 'Preserve saved scale, primary and mode');
assert(profileMonitorDetails(profile, changed)[0].width === null, 'Never borrow mode metadata from different hardware');
let summary = formatProfileDetails(profile, displays, 'open');
assert(summary.includes('3840 × 2160') && summary.includes('120 Hz') && summary.includes('150%') && summary.includes('Off'),
    'Readable summary exposes resolution, rate, scale and the disabled display');
profile.config[2][0][5][0][1] = '3840x2160@143.999+vrr';
assert(!profileStatus(profile, displays, 'open').available, 'A missing saved refresh mode remains unavailable');
const offline = profileMonitorDetails(profile, []);
assert(offline[0].width === 3840 && offline[0].refresh === 143.999 && offline[0].vrr === true,
    'Recognizable stored mode IDs remain readable offline without changing their refresh');
summary = formatProfileDetails(profile, [], 'unknown');
assert(summary.includes('143.999 Hz') && summary.includes('VRR'), 'Do not round a saved 143.999 Hz profile down to 120 Hz');
profile.config[2][0][5][0][1] = 'opaque-offline-mode';
assert(profileMonitorDetails(profile, [])[0].width === null, 'Unknown mode syntax must not invent resolution');
assert(formatProfileDetails(profile, [], 'unknown').includes('opaque-offline-mode'), 'Show the saved ID when dimensions are unknown');
print(`${checks} profile detail checks passed`);

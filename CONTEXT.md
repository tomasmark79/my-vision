# Current work: compare the original extension

Updated 2026-11-08 after restoring profile OSD feedback.

## User request and constraints

The user chose to keep the verified 120 Hz profiles and restore native OSD.
That code change is installed and the user has now logged in again. They report
manual switching through My Vision works correctly at 120 Hz.
The user then suggested comparing the original Display Configuration Switcher,
from which My Vision was forked, to see whether it has the same fault. Upstream preparation is now complete; details below.
The user has explicitly requested the manual upstream 144 Hz comparison now.
It is activated as described below; no result has been reported yet. Do not start an automatic crash
sequence or assume that software USB-C recovery works. Do not log the user out.
My Vision is temporarily disabled ONLY for the now-authorized upstream comparison.
Restore it after the comparison; its saved profiles remain at 120 Hz.

The user also reports that selecting 144 Hz in GNOME Settings → Displays works.
We have NOT captured an identical complete transition from that UI, so do not
claim its payload, method or timing matches My Vision or the standalone script.

## Completed OSD restoration

- Uses native OSD on all active monitors after fresh state confirms the profile.
- Handles queued selections before OSD; skips intermediate and stale labels.
- Cancellation and destroy drop pending work; no new timers/signals/lifecycle flags.
- Uses documented GNOME 46–48 show(-1, ...) vs 49–50 showAll(...) APIs.
- Required checks passed: 55 profile checks, display/lid/cancellation, 4 async
  initialization scenarios, 31 Node startup/restore checks, recorder checks,
  schema compilation, live read-only smoke test, and diff check.
- Built via nix-shell shell.nix --run 'bash build.sh -b'. All seven JS files
  matched sources in ZIP and installed copy. No session reload or publication.
- Backup of previous installed extension:
  /home/tomas/.local/state/my-vision/backups/before-osd-restore-20261108-121400

## 144 Hz diagnosis and current settings

See docs/display-switching-diagnosis.md and docs/amd-144hz-upstream.md for the
verified comparison matrix and upstream research. Standalone Mutter requests
with My Vision disabled reproduced the gray screen at 144 Hz; 120 Hz passed
scripted and manual switching. Mutter versus AMD remains unresolved. Tests that
only passed on 60 Hz do not establish equivalent behavior at 144 Hz.

The approved open-lid/external-connected saved profiles remain:
- Gigabyte 120Hz (test), ID 6c7e143f-67fd-4f96-8ce0-c9d1cafdda38.
- Both 120Hz (test), ID d4429400-2c2a-4e7b-871b-62d58c36aebe.
Only their external refresh/names changed. Other hardware/lid contexts may still
contain 144 Hz/VRR. Latest read-only check confirmed those two use 120 Hz.

Private evidence and original 144 Hz fixtures:
/home/tomas/.local/state/my-vision/diagnostics/20261108-112603-754397/
Includes trace.jsonl, independent-trial.log, direct-display-profiles.json,
direct-display-refresh-variants.json, connector-audit.mjs, and profile backups.
The profile restore helper must not be run while the user wants to keep 120 Hz.

System: GNOME Shell/Mutter 50.5, kernel 7.4.0-rc1, Phoenix/DCN314, Gigabyte M32U
via USB-C DP. Exact kernel source is recorded in the upstream research document.
Session-only menu suppression expired around 11:43:38; no automatic switcher
remains. The passive one-hour recorder started 11:26:03; check status if needed.

## Original extension ready for a later manual comparison

Official Display Configuration Switcher v13 supports GNOME 46–50:
https://extensions.gnome.org/extension/7281/display-configuration-switcher/
UUID: display-configuration-switcher@knokelmaat.gitlab.com.
Installed unchanged from official ZIP, version_tag=70098; all nine packaged files
verified byte-for-byte. SHA256:
74acad00f3e470e7a503f15c32fd1dbcf2dd8a69119c195ba7fbc549c3ad375c

The user returned after a fresh login. Both extensions are now discovered.
At 12:22 CET, after read-only validation of all three exact profiles, connectors,
scales and open lid, My Vision was disabled and original v13 enabled. Verified
states: My Vision INACTIVE, original ACTIVE. Activation sent no Apply request;
the out-of-range startup index worked. User now switches manually using the
copied Ctrl+Alt+period / Ctrl+Alt+comma shortcuts.

Passive recorder: my-vision-upstream-capture.service, started 12:22:29 CET,
duration 1800 seconds. New evidence:
/home/tomas/.local/state/my-vision/diagnostics/20261108-122229-424962/
Markers: upstream-manual-test-before-activation and
upstream-enabled-manual-test-ready. No automated switching is scheduled.
Wait for the user's visual result; inspect actual Apply modes/timing and fresh
AMD errors. If gray, allow physical recovery, disable upstream and then restore
My Vision. Never leave both active (shared keybinding names).

Its separate schema now contains Notebook 120 Hz, Gigabyte 144 Hz and Both
144 Hz, copied from the original exact fixtures after read-only current
identity/mode/scale validation. Full connector/vendor/product/serial records
use the current topology. Upstream does not remap connectors or enforce lid
conditions: revalidate after reconnecting USB-C and use an open lid.

Prepared last-config-index=4294967295 deliberately falls outside the profile
array so upstream skips its automatic first-enable restore. Shortcuts copied
from My Vision. Both extensions register the same binding names: disable My
Vision BEFORE enabling upstream, and disable upstream BEFORE restoring My
Vision afterward. Do not run them together. The manual upstream test is ready; its visual outcome is pending.

Private preparation directory is the evidence directory's upstream-comparison/:
upstream-v13.zip, extension-info.json, prepared-requests.json,
prepare-settings.mjs, upstream-settings-before.json. The helper writes only
upstream settings and refuses nonempty existing profiles; do not rerun it.
My Vision profiles-v2 was verified unchanged by preparation.

Source comparison: original _onConfig calls applyMonitorsConfig directly,
method 1 (temporary), with cached serial, no pre-apply refresh, no request queue,
no awaited D-Bus completion, no profile OSD. It automatically loads a remembered
profile on first state unless the index is out of range as prepared above.
These differences justify a controlled comparison, not a predicted result.
User should be ready for physical USB-C recovery before any 144 Hz transition;
there is no authorized automatic crash loop. All tests must distinguish method
acceptance from a visible image. Restore My Vision after the comparison.

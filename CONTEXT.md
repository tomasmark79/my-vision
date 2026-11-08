# Current work: compare the original extension

Updated 2026-11-08 after restoring profile OSD feedback.

## User request and constraints

The user chose to keep the verified 120 Hz profiles and restore native OSD.
That code change is complete and installed on disk, awaiting a fresh GNOME login.
The user then suggested comparing the original Display Configuration Switcher,
from which My Vision was forked, to see whether it has the same fault. First
identify the upstream, check GNOME 50 compatibility and compare the apply path.
No new physical comparison has been run. Do not start another automatic crash
sequence or assume that software USB-C recovery works. Do not log the user out.
Keep My Vision enabled and saved profiles at 120 Hz while preparing a comparison.

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

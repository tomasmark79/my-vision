# Display investigation: tests stopped, mixed-refresh workaround

Updated 2026-11-08 after the user's mixed-refresh test report and 13:27:35 CET read-only snapshot.

## Current instruction and state

The user stopped all testing of the original extension after the same gray screen
appeared when cycling backward. They explicitly asked to preserve the successful
forward order and the difference between directions for future investigation.
No further crash tests or automatic switching. My Vision is ACTIVE again;
Display Configuration Switcher v13 is INACTIVE. The passive recorder has exited.
The user subsequently replaced the saved profiles with three open-lid profiles:
Gigabyte 120Hz (external only), Both 120Hz/144Hz (internal 120, external 144), and
BuiltIn 120Hz (internal only), in that order. All require both physical monitors
connected. The read-only snapshot confirms Both is currently active, fixed refresh
without VRR. The user reports successful switching in both directions and explicitly
identifies frequency as the sole discriminating factor in their tests: external-only
120 works, external-only 144 fails, both-enabled external 144 works. Preserve this
setup; do not restore any old test backups or lower Both to 120 automatically.
See the mixed-refresh section of docs/display-switching-diagnosis.md for IDs,
exact modes, layout, evidence path and limits. No new crash test is authorized.

## Durable findings

See docs/display-switching-diagnosis.md, especially “Original extension: forward
cycling passed, reverse cycling failed”, for exact times, payload comparison,
limitations and evidence paths. docs/amd-144hz-upstream.md preserves upstream
kernel research. No verified 144 Hz fix was found or implemented.

Native upstream profile order: Both, External, BuiltIn.
- Forward Ctrl+Alt+period: Both -> External -> BuiltIn -> Both passed initially.
  External activates alongside the internal panel, then internal is removed.
- Reverse Ctrl+Alt+comma includes BuiltIn -> External. At 12:31:56.011 CET this
  request was followed at 12:31:56.360 by AMD blank failure and later flip timeout.
- The same direct transition also passed once at 12:28:30.811, so do not claim
  direction alone proves causality or a universally safe workaround.
- Original native Both had internal Y=214 versus old fixture Y=238; other
  semantic request values matched. Original also failed with the new geometry.
- User perceived faster upstream switching. The then-current 500 ms state
  debounce and extra pre-apply refresh could affect latency, but are not proven
  hang causes. The user subsequently requested removal of the fixed delay:
  state refresh now uses one coalesced idle callback, retaining fresh-state
  serialization and cancellation. Profiles stayed at 120 Hz at that delivery;
  the user subsequently configured the mixed-refresh setup above.

The original native profiles remain saved; do not delete or overwrite them.
A read-only preview of equivalent My Vision profiles was prepared, but NEVER
applied. Do not activate it without a new user instruction.

## Evidence and installed work

Latest read-only snapshot: diagnostics/20261108-132735-mixed-refresh-readonly/
under ~/.local/state/my-vision/. Details are in the diagnosis document.

Latest stopped switching capture:
/home/tomas/.local/state/my-vision/diagnostics/20261108-122229-424962/
Contains trace.jsonl, native upstream profile snapshots, semantic differences,
and upstream-switch-order.json. Recorder unit my-vision-upstream-capture.service
is inactive. Earlier standalone 60/120/144 comparisons and original profile
backups are in ../20261108-112603-754397/.

OSD restoration commit e362c7e was built, installed and verified byte-for-byte
against sources. The user subsequently logged in again and reported My Vision
switching worked at 120 Hz. No additional production code changed during the
upstream comparison. Original v13 is installed unchanged from official EGO ZIP.

## Fixed-delay removal delivered

The user requested removal of the 500 ms delay. `_queueStateUpdate` now uses
GLib.idle_add at PRIORITY_DEFAULT_IDLE and coalesces pending updates. Fresh-state
serialization and teardown cancellation remain intact. A new regression failed
with the old timer and passed with the idle source; pending Apply, cancellation,
initialization, profile and startup/OSD checks all passed (55 profile checks,
4 initialization scenarios, 31 Node checks, plus display/cancellation checks).
The live read-only smoke test and Nix-shell build passed. Installed JS matches
the ZIP and reviewed working sources; the running Shell has NOT reloaded it.
A fresh login is needed to activate this change. No display switching test ran.
Existing unrelated formatting changes in eight workspace files were preserved
and excluded from the delay-removal commit.

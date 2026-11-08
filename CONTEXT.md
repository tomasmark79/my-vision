# Intermittent gray display investigation

Goal: identify and fix the intermittent gray display when switching My Vision.
Investigation reopened after a fresh reboot: removing OSD was NOT a complete fix.
The current source patch fixes verified shortcut autorepeat/queue defects. Physical
verification through the actual shortcut is still required; do not claim the gray
screen is fixed solely because direct profile-application probes passed.

## Current kernel comparison (11:26)

- User completed the Nixon build and rebooted themselves. Verified running
  Linux `7.4.0-rc1`, GNOME Shell 50.5, selected generation 1406. Generation
  1405 with Linux 7.3.1 remains available in the boot menu.
- Kernel-only configuration is committed in Nixon as `94e6947`. Kernel
  preparation is complete; physical gray-screen diagnosis continues here.
- My Vision is ACTIVE. All seven installed JavaScript modules match this repo.
  Open-lid external-connected test profiles still use fixed 144/120 Hz modes.
  Other hardware/lid contexts were not changed. External Gigabyte identity is
  correct and current external mode is 3840x2160@143.999, without VRR.
- Started passive user unit `my-vision-kernel74-capture.service` at 11:26:03,
  maximum duration 3600 seconds. Evidence directory:
  `/home/tomas/.local/state/my-vision/diagnostics/20261108-112603-754397/`.
  Initial collectors are healthy, no previous AMD blank/flip/commit timeout
  signatures in this boot before testing. No display writes or automatic
  recovery are performed. My Vision must stay enabled even after a failure.
- Await user testing through normal shortcuts, including Both. No physical
  comparison result on the new kernel yet; do not claim the issue is fixed.

## Previous kernel reproduction and recovery limits (09:56)

- User tested current no-OSD/no-VRR version: two switches worked, third gray.
  Therefore no-VRR is NOT a verified fix. User explicitly wants VRR left off.
- User authorized autonomous display tests and software USB-C/DP recovery.
  Healthy virtual hotplug worked with AMD `DP-2/trigger_hotplug` 0 then 1.
  Primary implementation: Linux v7.3 `amdgpu_dm_debugfs.c`, `trigger_hotplug`.
- External direct replay of nine mixed exact fixed-refresh profiles passed at
  09:45:29–09:45:56, all six directed transitions, no fresh kernel blank errors.
- Created external diagnostic uinput keyboard with documented modern UI_DEV_SETUP;
  actual Ctrl+Alt+period events reached the real extension handler and D-Bus.
  Four key presses at 09:46:05, :10, :22, :25 selected external/both/built-in/external.
  The fourth Apply at 09:46:25.407 caused the first blank error at 09:46:25.726.
  This is an agent-reproducible failure through the actual extension, not a unit test.
  Exact external request body matches successful direct call at 09:45:50.416
  (SHA256 prefix `ac6b43e64a`). This comparison is with direct D-Bus replay, NOT
  with native Win+P; do not tell user native GNOME sent identical parameters.
- Virtual hotplug recovery after real failure did NOT restore the laptop image;
  user needed several physical USB-C disconnects. Recorder/helper incorrectly
  labelled connector/EDID reappearance as `RECOVERY RESULT True`. This is not
  physical recovery. Do not run unattended tests relying on it.
- Second attempt used forced connector-off plus virtual hotplug with independent
  reset. Reset command had a diagnostic bug: debugfs force accepts max 11 bytes,
  so `unspecified\n` (12 bytes) was rejected. Forced-off remained set. At 09:51
  explicitly restored with `write_text('unspecified')`, readback confirmed.
  No pending root recovery timers or test input/replay processes remained.
- User now explicitly REQUIRES My Vision to stay enabled, also after a failure,
  so they can manually recover by unplugging USB-C and selecting a profile.
  Stop auto-disabling it for recovery or tests. At 09:56 verified ACTIVE and
  DP-2 force `unspecified`; current native logical config external-only.
  Removed all automatic recovery/disable actions from private observe-desktop.py;
  it now logs physical recovery is required. Do not resume automated switching.

## Current work after restart (09:05 onward)

- Fresh boot, Shell PID 3804, GNOME/Mutter 50.5; installed JavaScript matches the
  OSD-free repository revision `1a01eed` in all seven modules, no OSD references.
- User clarified the new failure was Ctrl+Alt+period, not the menu. Next shortcut
  is `<Control><Alt>period`, previous `<Control><Alt>comma`; not Win+P.
- At 09:05:55 Shell reported invalid logical-monitor/fullscreen indices; at
  09:05:56–57 AMD reported `failed to blank crtc`, then flip timeout at 09:06:07.
  This proves the previous OSD-only conclusion was too strong. README corrected.
- Started fresh passive capture at
  `/home/tomas/.local/state/my-vision/diagnostics/20261108-090801-328562/`.
  `latest` points here; current recording process session 77287. User's single
  short press at 09:17:27 produced exactly one successful Apply, no driver errors.
- Code review found: shortcuts used `Meta.KeyBindingFlags.NONE` (autorepeat allowed),
  cycling used stale `_activeConfig`, and queued requests drained immediately on
  method reply before the debounced state publication. Direct `_onConfig()` probes
  bypassed both key registration and `_cycleConfig()`.
- Three regression tests failed against original code: missing repeat suppression,
  two fast key presses dispatched `open,open` prematurely, and a press after reply
  dispatched before state publication. Fixed using IGNORE_AUTOREPEAT (verified in
  Mutter 46 `src/meta/prefs.h`, value 16), an application request `{id, context}`,
  and draining the latest queued selection only from refreshed `_onStateChanged`.
  `requestStateUpdate()` allows a subsequent selection to retry a failed/missing
  state publication. No lifecycle flags, new timers or speculative API guards.
- Additional coverage: latest queued cycle target, publication retry, old-context
  queue discard. Full checks passed: 55 profile, display/lid/cancellation, 4 init,
  24 Node startup/restore, 3 recorder checks, live read-only check, diff check.
- Built with `nix-shell shell.nix --run 'bash build.sh -b'`. ZIP JS matches source;
  SHA256 `39c76595f838b5d7f98bf2e07e7814b9f31b8b08903acc40450971f12451fe5a`.
- Verified source committed as `1616cb4`; installed the ZIP under the user's
  existing repair authorization. All ten packaged files matched the installed
  copy. Backup: `installed-before-shortcut-fix.zip` in the 09:08 evidence directory.
  No logout or session restart performed.
- Prepared session counterpart directly from reviewed source methods:
  `/home/tomas/.local/state/my-vision/diagnostics/20261108-090801-328562/apply-shortcut-fix.mjs`
  symlink `/tmp/my-vision-shortcut-fix-20261108.js`, Node syntax check passed.
  First helper failed midway in `_updateMenu`: the global Shell gettext wrapper
  inferred no extension URL from a method injected from `/tmp` (`url is null`).
  It had replaced methods but had not re-registered key bindings.
- Corrected helper `apply-shortcut-fix-v2.mjs` explicitly binds translations with
  `Extension.defineTranslationFunctions()` to the installed extension URL and
  imports `displayRecord` used by saving. Translation lookup is checked before
  mutations. Six injected method bodies match reviewed source exactly; Node syntax
  check passed. User ran the new `/tmp/my-vision-shortcut-fix-20261108-v2.js`
  successfully around 09:25, including binding replacement. This does not switch
  displays. User is now testing 6–10 short actual Ctrl+Alt+period presses, waiting
  for each picture to settle, through external/built-in/both profiles.
- Additional pre-patch evidence: an Apply at 09:18:22.311 was followed by AMD blank
  errors before the next Apply at 09:18:45.238. Queue conflicts alone cannot explain
  all failures. Do not claim the shortcut queue fix resolves the physical failure
  until the actual key path is tested; no post-patch visual result yet.

## Latest status (09:37)

- User confirmed the live shortcut fix still fails repeatedly. It is NOT a fix
  for the physical display failure. Do not keep targeting key bindings.
- Disabled My Vision again at about 09:29 to prevent automatic restoration after
  USB-C recovery. Currently INACTIVE; do not assume it has been re-enabled.
- Earlier normal-exec recorder disappeared at 09:20:45, without a stop record.
  Its trace is incomplete after that point. Started a durable passive recorder
  via user systemd unit `my-vision-display-capture-0927.service` at 09:26:32,
  duration 3600s. Evidence directory and `latest`:
  `/home/tomas/.local/state/my-vision/diagnostics/20261108-092632-951249/`.
- At 09:27:41.385 a singleton external-144-VRR Apply returned at 09:27:41.400;
  first actual kernel blank error timestamp is 09:27:41.711. No second Apply
  precedes that error. The next Apply is recovery at 09:27:58.
- Canonical D-Bus request bodies (omitting only monitor state serial) match the
  earlier successful probes exactly: external VRR `e075d9bf9f`, built-in VRR
  `51ae3334c3`; SHA256 prefixes computed over dbus-monitor body lines. Malformed
  request data has not been demonstrated. This does not exclude side effects
  of the surrounding Shell extension code or differences in desktop/GPU state.
- At 09:27:58 kernel reported invalid EDID checksum. At 09:30 external DP-2 had
  zero-byte sysfs EDID and Mutter exposed only unknown/unknown/unknown with
  640x480@59.940. Saved `unknown-monitor-state.jsonl` and
  `unknown-monitor-edid.json` in latest evidence directory. This is a later
  failure/recovery state, not evidence that EDID corruption caused the first hang.
- User power-cycled monitor and reconnected; identity recovered to Gigabyte M32U
  with 384-byte EDID, all three checksums zero, SHA256
  `9e95b249da133e2151f5ddd4d33219a2b8f0335f06cca90b5dd574b80e865106`.
  Native external-only state then was 3840x2160@143.999 FIXED, scale 1.5.
  User wants focus back on extension; do not pursue EDID as the main issue.
- Official GNOME 50.5 sources saved under `native-sources/` in latest directory.
  Win+P closes switcher then calls `monitorManager.switch_config`; Mutter queues
  idle callback and generates config before temporary apply. Our extension uses
  explicit ApplyMonitorsConfig with exact saved modes/properties. Both eventually
  reach `meta_monitor_manager_apply_monitors_config`; native Win+P is not an
  equivalent exact-profile test. Do not change API merely based on this difference.
- Important isolation gap: initial fixed-refresh failure still had native OSD;
  successful no-OSD+fixed-refresh probes precede restored VRR and reboot.
  Current native fixed-144 state differed from saved external +vrr profile.
  Neither VRR alone nor OSD alone has been proven to explain all failures.
- Under existing user authorization for no-VRR profile test, prepared current
  no-OSD version with exact fixed-refresh counterparts of the two open-lid,
  external-connected profiles. IDs, other profiles and legacy settings preserved;
  exact frequency/resolution/scale checked against current live Mutter modes.
  Script `test-fixed-refresh-without-osd.mjs` and original/applied backup JSONs
  (`profiles-v2-before-vrr-test.json`, `profiles-v2-without-vrr-test.json`) are in
  latest evidence directory. This changed profiles only, no display apply.
  Restore command: `gjs -m <latest-dir>/test-fixed-refresh-without-osd.mjs restore`;
  script refuses to overwrite subsequently edited test profiles.
- Do NOT auto-enable based on earlier external-only state: a read at 09:36 found
  actual native state built-in-only fixed120, while remembered profile remained
  external-only. Re-enabling would actively switch the display. My Vision remains
  disabled and further actual desktop switching needs coordination with the user.
- User rejects treating unit-test PASS or automated probes as physical verification.
  Existing regression tests validate separate queue defects only. No verified
  root-cause code fix for the physical gray screen exists yet.

## Confirmed reproduction (2026-11-08, Europe/Prague)

- User confirmed the gray screen and had to unplug USB-C to recover the laptop.
- GNOME/Mutter 50.5, Wayland, Linux 7.3.1, amdgpu PCI 1002:15bf.
- Installed extension JavaScript matches this repository byte for byte.
- At 08:19:00 external DP-2 was active in `3840x2160@143.999+vrr`,
  scale 1.5; built-in eDP-1 was disabled.
- At 08:19:07.062 Shell sent one `ApplyMonitorsConfig` (caller/owner `:1.7`,
  serial 4047), requesting only eDP-1 `2560x1600@120.001+vrr`,
  scale 1.6666666269302368. Mutter replied successfully at 08:19:07.086.
- A read immediately afterward reported the requested logical configuration.
- At 08:19:10 the kernel reported `[CRTC:381:crtc-0] flip_done timed out`.
  Subsequent errors included `hw_done or flip_done timed out`, CRTC/plane
  `commit wait timed out`, and viewport validation warnings.
- `GetCurrentState` timed out while Shell was blocked. USB disconnect was logged
  from 08:19:12. Additional requests queued during the stall reached the bus around
  08:19:38, after the first failure; they do not explain the initial timeout.
- At 08:19:41 the monitor topology changed to built-in only; automatic restore
  selected the saved 60 Hz VRR built-in profile for that distinct hardware context.
- Symptom marker was entered at 08:19:53 after the user could communicate again;
  it is confirmation of the earlier event, not the precise failure timestamp.

Evidence stays outside Git under
`/home/tomas/.local/state/my-vision/diagnostics/20261108-081900-256480/trace.jsonl`.
The collector was started for 1800 seconds, with no display/settings writes.
Earlier short smoke captures exist alongside it. Current capture can be marked
or stopped with `python3 tools/capture-display.py mark LABEL` / `stop`.

## Next steps

1. VRR-only hypothesis failed: the user confirmed a second gray-screen incident
   with fixed-refresh profiles at about 08:23. The requests contained no `+vrr`.
   The failing switch was built-in-only to external-only at 08:23:16.701; kernel
   logged `dcn20_wait_for_blank_complete: failed to blank crtc!` at 08:23:17,
   followed by flip/commit timeouts. This is an AMD display power/modeset failure;
   the exact trigger remains unconfirmed.
   The user also reported 3-second pauses did not help (third failure around
   08:25); the trace does not establish that the requested intermediate `Both`
   layout reached the bus before the timeout, so do not claim that the two-step
   strategy was conclusively tested.
2. User authorized temporarily disabling VRR in the two open-lid,
   external-connected profiles. Applied and verified: external-only 144 Hz and
   built-in-only 120 Hz use their exact fixed-refresh counterparts. IDs, order,
   topology, lid conditions, geometry, frequency and selections were preserved.
   Legacy settings and all other profiles were untouched. The user noted having
   previously disabled VRR in GNOME settings; saved profiles were re-enabling it.
   Fixed-refresh switches reproduced the failure; see above.
   Exact backups and the test plan are in the evidence directory above:
   `profiles-v2-before-vrr-test.json`, `profiles-v2-without-vrr-test.json`,
   `vrr-test-plan.json`. `test-fixed-refresh.mjs` supports `restore`, restoring
   only those two configurations while retaining subsequent remembered selections;
   it refuses to overwrite profiles edited since the test. Do not restore while
   the user is still testing. No automatic display apply was made by this script;
   the extension reloads the changed profiles through its existing settings signal.
   Closed-lid and built-in-without-external profiles still contain their original
   VRR settings; test with the lid open and USB-C connected.
3. User authorized a temporary live PSR test. At 08:27:12 wrote `1` to
   `/sys/kernel/debug/dri/1/eDP-1/disallow_edp_enter_psr` and verified readback.
   Original value `0` is saved in `psr-test-before.json`; applied value in
   `psr-test-applied.json` in the evidence directory. This changes the PSR
   eligibility for subsequent panel mode/power transitions, not instant PSR state.
   This also failed: at 08:27:41.914 external-only fixed 144 Hz was requested,
   at 08:27:42 the same blank-CRTC errors began, followed by flip timeouts.
   Readback still showed the PSR exclusion flag `1`, state `0`.
   No boot parameters or persistent
   host configuration have been changed. Restore by writing `0` to that exact
   node when appropriate; keep a trace marker for comparisons.
   Read-only debugfs showed panel PSR support yes, panel replay support no,
   DMCUB firmware 0x08006500. Kernel implementation was checked at
   https://raw.githubusercontent.com/torvalds/linux/v7.3/drivers/gpu/drm/amd/display/amdgpu_dm/amdgpu_dm_debugfs.c
   (`disallow_edp_enter_psr_set`).
   Compare kernel errors and visible output. No unattended command can currently
   assert the exact physical gray-screen symptom.
4. If a kernel/system fix is needed, consult `~/.codex/PROJECTS.md` to identify
   its owning project; do not change host configuration speculatively.

## Important isolation results (08:29 onward)

- User authorized disabling My Vision temporarily for a GNOME Settings test.
  `gnome-extensions info` verified `Enabled: No`, `State: INACTIVE`.
- Native GNOME switching did not fail, but Win+P/GNOME kept reverting the external
  output to 60 Hz or changing resolution/mirroring. Some 4K/144 Hz requests were
  captured, but the test was not a controlled equivalent of the failing sequence.
- User then authorized direct automatic switching, later explicitly requested 20
  steps and random transitions including `Both` and every direction among the
  three states. Prepared disposable `replay-profiles.mjs` in the evidence directory.
  It imports the real repository `DisplayConfigSwitcher` and `applyProfile()`,
  reads the current saved profiles without writing settings, uses 3-second pauses
  and a 4-second D-Bus proxy timeout, and stops on failed state reads.
- Results with extension inactive, no Shell UI/OSD, fixed-refresh test profiles
  and PSR exclusion still `1`: six steps (five effective applies) passed with user
  visual confirmation; 20 alternating steps passed; 20 mixed/random steps passed
  with user visual confirmation and 20 matching D-Bus replies, no AMD errors.
- Mixed sequence seed 20261108, indices external=0, built-in=1, both=2:
  `[0,1,0,1,2,1,0,1,2,0,1,0,2,1,2,1,2,0,2,0]`.
  Includes every directed transition. Exact modes remain 4K/144 Hz and 1600p/120 Hz.
- This strongly implicates something in the Shell extension path. It does NOT yet
  identify OSD, menu handling, or self-issued D-Bus requests as the root cause.
  The core profile application code also ran successfully in the standalone test.
- Next test prepared: Shell-only `shell-probe.mjs` in evidence directory, with
  symlink `/tmp/my-vision-probe-20261108.js`. User was asked to open Alt+F2 → `lg`
  and run:
  `(await import('file:///tmp/my-vision-probe-20261108.js')).start(false)`
  It closes Looking Glass, enables the original extension, temporarily suppresses
  only `_showPendingOsd`, and runs the same 20 mixed steps through the REAL
  toggle's `_onConfig()`. Logs use `[My Vision probe]`. It restores the original
  OSD method and proxy timeout afterward unless the owner was cancelled.
  `start(true)` is supported for a subsequent comparison with OSD enabled.
  User executed the command; the Shell probe started at 08:50:09 and completed
  all 20 mixed steps at 08:51:15, with explicit `OSD suppressed` messages and no
  new AMD errors. User confirmed no visible failure. Asked user to run
  `start(true)` to compare the same sequence with native OSD restored before
  declaring OSD the cause. The helper restores original OSD after each run.
  The initial recorder expired at about 08:49; started a new 1800-second capture
  at `/home/tomas/.local/state/my-vision/diagnostics/20261108-085034-326389/`.
  `latest` now points there. Backfilled the initial probe journal events into
  `shell-probe-journal.jsonl` in the original evidence directory; the first probe
  steps lack a D-Bus trace but remain covered by Shell/kernel journal messages.
- OSD-enabled comparison started at 08:52:04. The same sequence began showing
  blank-CRTC errors around the `Both` → built-in transition at 08:52:25, followed
  by flip/commit timeouts. The user confirmed immediate visible collapse within
  a few switches. Disabled My Vision to cancel the probe; `INACTIVE` verified.
  This isolates native profile OSD as the trigger in the extension path. It does
  not establish the precise defect inside Shell/compositor/driver implementation.
- Implemented minimal fix: remove profile OSD and its pending-state bookkeeping
  from `extension.js`; retain active profile name/checkmark in Quick Settings.
  Replaced OSD-success tests with 20 mixed-switch checks for GNOME 46–50 that
  prohibit native OSD calls while preserving remembered selections. They failed
  against original sources (5 expected assertion failures), then passed after fix.
- Built via `nix-shell shell.nix --run 'bash build.sh -b'`.
  ZIP: `dist/my-vision@digitalspace.name.zip`, seven JavaScript modules verified
  byte-for-byte against source; diagnostics excluded.
  SHA-256: `29c69a6c8b35521eeb5a31380ee57b452d0cb59ab1c799ed73afef7dbcaf760c`.
  User explicitly authorized installation; `gnome-extensions install --force`
  completed and all 10 installed files match the ZIP byte-for-byte. Previous
  installed directory backed up as `installed-before-fix.zip` in original evidence
  directory. No session restart or publication.
- Restored temporary test changes: PSR exclusion flag back to original `0`;
  the two test profile configurations restored exactly from backup, preserving
  remembered selections made during the investigation. Their original VRR modes
  are therefore restored. No persistent host configuration was changed.
- Prepared current-session fix helper `apply-osd-fix.mjs` in original evidence
  directory, symlink `/tmp/my-vision-osd-fix-20261108.js` (syntax checked only).
  Looking Glass command:
  `(await import('file:///tmp/my-vision-osd-fix-20261108.js')).apply()`
  It enables My Vision and suppresses profile OSD on the cached toggle prototype,
  surviving disable/enable in this Shell. New installed code takes over next login.
  This avoids unsafe mode and restarting the session. User must execute locally.
  Afterward run the 20 mixed `start(false)` probe with restored original VRR/PSR
  settings and confirm physical output plus journal health. Do not use `start(true)`
  as an OSD-positive control after patching the prototype: original OSD is then gone.
  User was given a single Looking Glass command combining activation and final test:
  `await (await import('file:///tmp/my-vision-osd-fix-20261108.js')).apply(); (await import('file:///tmp/my-vision-probe-20261108.js')).start(false)`
  Await execution, `[My Vision fix]` confirmation, twenty-step PASS and physical
  confirmation. Source installation alone does not activate cached Shell code.
- GNOME Shell Eval returned `(false, '')`: unsafe mode is not enabled. Do not
  enable unsafe mode or bypass Shell's sender checks. Direct remote ShowOSD is
  also sender-restricted. Looking Glass is the intended local diagnostic path.
- Checked official GNOME 50.5 sources: extension modules are cached and cannot
  simply load changed JavaScript after disable/enable. No new extension sources
  have been installed and the session has not been restarted.

## Verification so far

- Recorder tests: 3 passed (reply correlation and journal component filtering);
  real live trace includes the matching
  Apply reply and monitor signals, successful state reads and kernel failures.
- Schema compilation, profile checks (55), display configuration/lid/cancellation
  checks, asynchronous initialization (4), startup/restore checks (19) all passed.
- `gjs -m tests/live-read-only.js` passed. This reads live state only; the physical
  failure was reproduced separately by the user.
- `git diff --check` passed after adding the recorder documentation.
- Initial diagnostic tooling committed locally as `1ffc804`; subsequent journal
  filtering improvements retain USB disconnections and exclude unrelated services.
  The current recording still uses the initial filter; leave it running to avoid
  losing events during the physical test.
- Full regression checks passed after the fix: profile 55, display/lid/cancellation,
  initialization 4, startup/restore 18, diagnostic tool 3. A live read-only check
  initially failed inside Context Mode because its subprocess lacks session D-Bus
  environment; reran with normal exec in the desktop environment and it passed.
- Pending: live helper activation and final 20-step verification after restoring
  original VRR/PSR settings. Build and authorized installation complete; no session
  restart or publication.

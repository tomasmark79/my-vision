# Intermittent gray display investigation

Goal: identify and fix the intermittent gray external display when switching
My Vision profiles or reconnecting USB-C. A/B testing isolated profile OSD as the
trigger. Sources now remove it, all regression checks and packaging passed.
Installation and final verification with original settings are still pending.

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
  Nothing installed or published yet. Seek the user's instruction for installation
  once this concrete artifact is ready; never log the user out automatically.
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
- Pending: installation authorization, optional live helper activation and final
  20-step verification after restoring original VRR/PSR settings. Build complete;
  no installation, session reload or publication yet.

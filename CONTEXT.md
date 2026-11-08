# Intermittent gray display investigation

Goal: identify and fix the intermittent gray external display when switching
My Vision profiles or reconnecting USB-C. Investigation is ongoing; no runtime
extension code has been changed and no fix is yet verified.

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

1. Isolate VRR at unchanged frequencies, then simultaneous display disable/enable,
   then USB-C/driver behavior independent of My Vision. Do not treat a hypothesis
   as a confirmed root cause or silently remove VRR from users' profiles.
2. User authorized temporarily disabling VRR in the two open-lid,
   external-connected profiles. Applied and verified: external-only 144 Hz and
   built-in-only 120 Hz use their exact fixed-refresh counterparts. IDs, order,
   topology, lid conditions, geometry, frequency and selections were preserved.
   Legacy settings and all other profiles were untouched. The user noted having
   previously disabled VRR in GNOME settings; saved profiles were re-enabling it.
   Awaiting repeated physical switches with the fixed-refresh profiles.
   Exact backups and the test plan are in the evidence directory above:
   `profiles-v2-before-vrr-test.json`, `profiles-v2-without-vrr-test.json`,
   `vrr-test-plan.json`. `test-fixed-refresh.mjs` supports `restore`, restoring
   only those two configurations while retaining subsequent remembered selections;
   it refuses to overwrite profiles edited since the test. Do not restore while
   the user is still testing. No automatic display apply was made by this script;
   the extension reloads the changed profiles through its existing settings signal.
   Closed-lid and built-in-without-external profiles still contain their original
   VRR settings; test with the lid open and USB-C connected.
3. Compare repeated physical switches with the known failing transition and
   inspect kernel errors as well as visible output. No unattended command can
   currently assert the exact physical gray-screen symptom.
4. If a kernel/system fix is needed, consult `~/.codex/PROJECTS.md` to identify
   its owning project; do not change host configuration speculatively.

## Verification so far

- Recorder correlation tests: 2 passed; real live trace includes the matching
  Apply reply and monitor signals, successful state reads and kernel failures.
- Schema compilation, profile checks (55), display configuration/lid/cancellation
  checks, asynchronous initialization (4), startup/restore checks (19) all passed.
- `gjs -m tests/live-read-only.js` passed. This reads live state only; the physical
  failure was reproduced separately by the user.
- `git diff --check` passed after adding the recorder documentation.
- Pending: local commit of verified diagnostic tooling and
  controlled comparison. No build, installation, session reload or publication.

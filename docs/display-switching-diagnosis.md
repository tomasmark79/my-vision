# Gray display during monitor switching

Updated 2026-11-08. This records one hardware-specific investigation, not a
general assertion about all AMD or GNOME systems. After the source review, the
user chose to close this investigation with the working 120 Hz profiles and
restore native profile OSD feedback. No further crash tests are planned.

## Established result

The gray display can occur with My Vision disabled, using an independent
Gio/D-Bus client that imports no extension modules. This rules out the extension
as a necessary trigger. It does **not** distinguish Mutter from the AMD
kernel/firmware stack: the independent client still calls Mutter's
`ApplyMonitorsConfig`.

The external 4K/120 Hz configuration passed the tested transitions, including
manual extension shortcuts. The 144 Hz failure remains unresolved. Changing the
kernel from 7.3.1 to 7.4-rc1 did not eliminate it.

## Environment and evidence

- HP ZBook Firefly 14 G10 A, AMD Phoenix `1002:15bf`, DCN 3.1.4.
- Gigabyte M32U over USB-C DisplayPort, four HBR3 lanes; internal AUO panel.
- GNOME Shell/Mutter 50.5; comparison tests below on Linux 7.4.0-rc1.
- Display Core 3.2.401, DMUB firmware `0x08006500`.
- External scale 1.5; built-in 2560×1600 at approximately 120 Hz, scale
  1.6666666269302368. Fixed external refresh, without VRR in these tests.

Private raw evidence is under
`~/.local/state/my-vision/diagnostics/20261108-112603-754397/`.
`independent-trial.log` contains the standalone requests and trial results;
`trace.jsonl` contains passive D-Bus and kernel observations. Times below are
local CET; JSON request timestamps use UTC. Use the kernel journal's own
`__REALTIME_TIMESTAMP`, not delayed recorder ingestion, for event ordering.

| Comparison | Observation |
| --- | --- |
| Extension disabled, 144 Hz, approximately 5-second gaps | Initial ten requests passed visually. |
| Extension active, 144 Hz, approximately 5-second gaps | A later notebook → external transition failed. |
| Extension active, menu actor changes suppressed | Slow scripted requests passed; manual shortcut switching still failed. |
| Extension disabled, 144 Hz, approximately 0.7-second actual gaps, 11:44:59–11:45:01 | Both → notebook → external failed before the extension was re-enabled. |
| Extension disabled, 60 Hz, two rapid cycles, 11:50 | Passed visually and without new AMD errors; DSC was off. |
| Extension disabled, 120 Hz, two rapid cycles, 11:51 | Passed visually and without new AMD errors; DSC was on. |
| Extension disabled, 144 Hz control, 11:52 | Failed again. |
| Extension disabled, notebook → external 120 → external 144, 11:53–11:54 | Failed on the increase to 144, with the internal panel already off. |
| Extension active, explicitly saved 120 Hz profiles, after 11:57 | User confirmed 10–15 manual switches passed; trace recorded 26 actual Apply requests and no new AMD errors. |

The 26 requests are not a count of physical key presses. These finite successful
tests establish a useful workaround, not indefinite reliability. Earlier GNOME
settings/Win+P comparisons that reverted the monitor to 60 Hz were not equivalent
144 Hz controls. The user also reports that explicitly selecting 144 Hz in
GNOME Settings → Displays works. That shows that the mode can operate; it does
not establish that a profile's preceding state and complete transition match
that settings-panel action. A shared Mutter API is not proof of identical
payloads, application method, timing, or monitor enable/disable sequence.

Failures included `dcn20_wait_for_blank_complete: DC: failed to blank crtc!`,
followed by flip/commit timeouts. The errors locate the observed stall in the
display pipeline, but do not identify who first caused invalid state. A successful
D-Bus reply or correct reported logical layout does not prove a working image.
Physical USB-C reconnection was needed; software recovery was unreliable.

## Findings that constrain the diagnosis

- The failing recorded requests addressed the expected physical monitors.
  A read-only audit of the actual profile request builder also passed reversed
  enumeration and synthetic connector renumbering. Saved DP-1 correctly remapped
  to current DP-2. Connector confusion was not observed in these failures.
- OSD removal, shortcut fixes, and temporary menu suppression were not complete
  remedies. Differences between slow scripted and fast manual tests initially
  confounded attribution to the extension.
- Timing affects reproducibility, but a later slow transition also failed; a
  longer delay alone is not established as a reliable fix.
- DSC is active at the successful 120 Hz setting as well as 144 Hz. DSC being
  enabled alone therefore does not explain the difference. Its parameters,
  clocks, timing, ODM configuration and sink behavior remain possible factors.
- The staged 120 → 144 attempt failed too; it is not an implemented workaround.

## Mutter source review

In Mutter 50.5, `meta_kms_update_get_needs_modeset()` recognizes mode-setting
updates. The atomic backend selects `DRM_MODE_ATOMIC_ALLOW_MODESET` for those
updates and `DRM_MODE_ATOMIC_NONBLOCK` only in the opposite branch. Thus the
simple theory that Mutter issues all modesets as nonblocking DRM commits is
not supported by this code. This does not establish when a D-Bus reply occurs
relative to KMS worker completion, or prove the transaction contents are correct.
[Update classification](https://github.com/GNOME/mutter/blob/50.5/src/backends/native/meta-kms-update.c),
[atomic commit implementation](https://github.com/GNOME/mutter/blob/50.5/src/backends/native/meta-kms-impl-device-atomic.c).

The stable branch NEWS lists an external-monitor hotplug hang fix in 50.5,
the version already used here. Its 50.6 section does not name a matching AMD
144 Hz fix. Release notes alone cannot rule out a relevant fix under a generic
entry. The full newer-commit comparison was not available (GitHub API returned
HTTP 504); no claim is made that every subsequent Mutter change was inspected.
[Mutter stable NEWS](https://raw.githubusercontent.com/GNOME/mutter/gnome-50/NEWS).

The [AMD upstream review](amd-144hz-upstream.md) compares candidate patches with
the exact source of the running kernel. No verified applicable fix was found:
several candidates are already present, target another hardware generation, or
affect a path not enabled for this Phoenix configuration.

## Current workaround and continuation

With user approval, only the open-lid, external-connected `Gigabyte` and `Both`
profiles were changed to exact `3840x2160@120.000` and renamed
`Gigabyte 120Hz (test)` and `Both 120Hz (test)`. Stable IDs, layout, scale, other
properties and other hardware/lid contexts were preserved. Other contexts may
still contain 144 Hz or VRR; this was not a global settings conversion.

The evidence directory contains `profiles-before-120hz-test.json`,
`profiles-with-120hz-test.json`, and `test-120hz-profiles.mjs`. Its guarded restore
operation refuses to overwrite subsequently changed profile configurations.
Do not restore them under the current instruction to keep 120 Hz.

My Vision remains enabled for normal use and recovery. The source-research phase
produced no kernel or extension fix for the 144 Hz fault. At the user's request,
native OSD feedback was subsequently restored: it waits for refreshed state to
confirm the requested profile, skips intermediate queued selections, and drops
stale or cancelled work. GNOME 46–48 use `show(-1, ...)`; 49–50 use `showAll(...)`,
following the [GNOME 49 API change](https://gjs.guide/extensions/upgrading/gnome-shell-49.html#osdwindowmanager).
Shell owns the native OSD actors and hide timers; the extension adds no OSD timer
or monitor signal connection and releases its pending label during destruction.

This closes the investigation with a workaround, not a 144 Hz repair. If reopened,
compare saved mode timings, Mutter transaction construction and DCN314 ODM/DSC
handling. Additional disruptive tests need a new agreement with the user. Do not
treat timeout messages or a similarly titled upstream patch as sufficient diagnosis.

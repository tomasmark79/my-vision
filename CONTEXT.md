# Continuing the 144 Hz gray-display investigation

Updated 2026-11-08 after the 120 Hz manual verification and upstream source review.
Goal: identify an actual fix for external 4K/144 Hz without disturbing the working
120 Hz session. The issue is not fully resolved.

## Current user instruction

Keep 120 Hz and continue research **without further crash tests**. Leave My Vision
enabled. No display switching, automatic reproducer, profile restoration, debugfs
writes, reboot/logout, kernel activation, or new runtime patch is authorized by
this continuation. Earlier permission for crash tests is superseded. Software
USB-C recovery proved unreliable; the user cannot type while the screen is gray.

## Established result

See [the diagnosis](docs/display-switching-diagnosis.md) for the test matrix,
source references and limitations, and [the AMD review](docs/amd-144hz-upstream.md)
for candidate patch applicability. These replace the earlier chronological notes
that attributed the failure to OSD, menu rebuilding or shortcuts alone.

- Independent Gio/D-Bus calls with My Vision disabled reproduced physical gray
  output and AMD blank/flip timeouts at 144 Hz. Mutter remains in that path.
- Rapid 60 Hz and 120 Hz scripted comparisons passed visually; 120 Hz uses DSC.
- The 144 Hz control failed, as did builtin -> external120 -> external144.
- Approved 120 Hz saved profiles passed the user's manual shortcut session:
  10–15 reported switches, 26 actual Apply requests in the trace, no new errors.
- Linux 7.4.0-rc1 did not eliminate failures previously observed on 7.3.1.
- No verified applicable upstream fix found. Do not claim that Mutter or AMD
  alone is proven responsible, or that extension code changes solved 144 Hz.

## Current configuration

GNOME Shell/Mutter 50.5; AMD Phoenix/DCN314, Gigabyte M32U via USB-C DP.
Production extension JS was last verified as matching revision 1616cb4; no
production JS changed in this investigation phase. Session menu suppression
expired and restored itself around 11:43:38. No automatic switcher remains.

The approved open-lid/external-connected profiles are now:

- `Gigabyte 120Hz (test)`, ID `6c7e143f-67fd-4f96-8ce0-c9d1cafdda38`.
- `Both 120Hz (test)`, ID `d4429400-2c2a-4e7b-871b-62d58c36aebe`.

Only their external mode and names changed, to fixed `3840x2160@120.000`.
IDs/order/layout/scales and other contexts were preserved. Other contexts may
still contain 144 Hz/VRR. Keep the backups; do not execute their restore helper.

## Evidence and tools

Evidence directory:
`/home/tomas/.local/state/my-vision/diagnostics/20261108-112603-754397/`

- `trace.jsonl`: passive D-Bus and journal evidence. Kernel event time is
  `__REALTIME_TIMESTAMP`; recorder ingestion can lag several seconds.
- `independent-trial.log`: standalone requests, checks and extension restoration
  markers. The decisive extension-disabled failure began at 11:45:01.605 CET;
  extension restoration was later, at 11:45:03.870.
- `direct-display-profiles.json`: frozen original 144 Hz targets.
- `direct-display-refresh-variants.json`: additional 60/120 Hz comparison targets.
- `connector-audit.mjs`: current and synthetic connector mapping audit; passed.
- `profiles-before-120hz-test.json`, `profiles-with-120hz-test.json`, and
  `test-120hz-profiles.mjs`: approved profile-change backups/helper.
- `mutter-source-50.5/`, `mutter-gnome-50-NEWS.txt`, `mutter-main-NEWS.txt`:
  primary-source snapshots for the read-only investigation.
- `before-144-*` captures pre-failure hardware state. `after-144-failure-*`
  captures show a recovered builtin state; do not interpret them as the failing
  144 Hz hardware state.

`tools/direct-display.mjs` is the committed independent client. Default preview
is read-only; apply changes displays. `/tmp/my-vision-direct-trial.py` is an
uncommitted external orchestrator: DO NOT RUN under the current instruction.
The passive recorder started at 11:26:03 for 3600 seconds; check its current
status rather than assuming it remains active. No need to restart it for research.

Exact running-kernel source:
`/nix/store/073g58m4xz09kk5jb7c79yyb6xp564a6-source`.
Kernel output: `/nix/store/n3vx9lgkyxm059nfkwndn3dfgsdhz1zr-linux-7.4-rc1`.
Kernel configuration belongs to `/home/tomas/.config/nixon`; its prepared kernel
change was committed as 94e6947 and boot-completion context as f9cf722. No further
Nixon change is currently needed.

## Remaining work and verification

A safe next research step is comparing saved 120/144 mode timing and DCN314
ODM/DSC handling, or preparing a sanitized upstream issue report. Do not publish
or send the report without instruction. Static source review has not identified
a defective line or safe patch. Future physical comparisons need renewed scope.

Standalone tool regression checks previously passed: schema/profile (55),
display configuration/cancellation, initialization (4), startup/restore (24),
syntax and diff checks; preview refused incorrect identities/count/mode and
ambiguous mappings. Live visibility is documented separately in the diagnosis.
The latest research phase changes documentation only, so check its claims,
links and formatting rather than rerunning disruptive tests or building a ZIP.
No new extension installation, Shell reload or publication was performed.

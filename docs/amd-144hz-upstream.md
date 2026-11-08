# Phoenix 4K144 modeset: upstream research

Research date: 2026-11-08. This investigation reads upstream patches and existing
kernel sources only. It does not change display configuration, firmware, kernel
parameters, or profiles. Keep the working 120 Hz configuration; further crash
reproduction is not authorized.

## Scope and conclusion

The reported system is AMD Phoenix `1002:15bf`, DCN 3.1.4, DMUB `0x08006500`,
with a Gigabyte M32U connected through USB-C DisplayPort SST, HBR3, four lanes.
Existing observations supplied to this investigation are:

- Valid Mutter requests for external 3840×2160 at approximately 144 Hz, scale
  1.5, can lead to `dcn20_wait_for_blank_complete`, `flip_done` timeouts, and
  persistent gray output requiring physical cable reconnection.
- An independent Gio/D-Bus client reproduces this with My Vision disabled.
- Equivalent 60 Hz and 120 Hz transitions passed; 120 Hz also uses DSC.
- Built-in → external 120 Hz → external 144 Hz failed on the last transition,
  with the built-in display already disabled.
- The user's subsequent 120 Hz profile session completed 26 requests without
  reported errors. Failures were observed on Linux 7.3.1 and 7.4-rc1.

These observations exclude My Vision as a necessary trigger, but do not separate
Mutter's KMS transaction construction from the AMD kernel/firmware implementation.
The kernel messages identify a display-engine failure, not its initial cause.
Successful DSC at 120 Hz rules out the proposition that merely enabling DSC is
sufficient. It does not rule out differences in DSC parameters, ODM topology,
timing dividers, clock requirements, or link/sink behavior at 144 Hz.

**No verified upstream fix for this exact hardware and transition was found.**
Several superficially matching fixes either target another display generation or
are already present in the failing 7.4-rc1 source. None justifies another crash
test, an experimental backport, or a claim that a newer kernel will fix it.

## Source verification

The parent investigation identified the source used by the running 7.4-rc1
kernel as:

```text
/nix/store/073g58m4xz09kk5jb7c79yyb6xp564a6-source
```

The file paths and line numbers below refer to that immutable tree, under
`drivers/gpu/drm/amd/display/`. They were read directly. Presence in this tree is
stronger evidence than a patch subject or mailing-list submission date. This
research did not independently inspect the 7.3.1 source or establish every
candidate's first released version.

## Closest symptom match: DCN35 ODM/DSC series

Mauricio Bellon's August series reports direct USB-C SST 4K120 → 4K144 output
loss on a ThinkPad X13 Gen 6, Krackan Point Radeon 840M, and Corsair Xeneon
32UHD144. That is a useful comparison, but it is DCN35, not this Phoenix DCN314.
The report also separates direct SST failures from dock/MST problems.
[Series and hardware description](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg149823.html).

Patch 1 changes only `dcn35_hwseq.c` and `dcn35_optc.c`. It coordinates ODM
updates with a horizontal-divider completion wait and manual-divider control.
The author reports odd horizontal blanking boundaries at 144 Hz versus timings
divisible by two at 120 Hz. This makes timing/ODM sequencing a reasonable
research direction, not proof of the same fault here.
[Patch 1](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg149827.html).

Local verification: `dc/hwss/dcn314/dcn314_init.c:151` selects
`dcn314_update_odm`, whose implementation is in `dcn314_hwseq.c:183`.
`dc/optc/dcn314/dcn314_optc.c` uses its own ODM combine/bypass and manual-divider
functions; its callback table has no `wait_odm_doublebuffer_pending_clear`.
These similarities do not establish that DCN32/DCN35 register semantics or the
proposed wait are safe for DCN314. No merged DCN314 adaptation was identified.

**Do not use patch 2, which moves sink DSC enablement before link training.**
AMD's Jerry Zuo rejected that ordering because it causes black screens; the
author agreed and withdrew that form of the change. The later follow-up still
asks for sequencing guidance before another revision. A report that it happened
to work on one monitor is explicitly insufficient here.
[AMD review](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg150988.html),
[author's agreement](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg151015.html),
[later follow-up](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg152650.html).

Status: proposal/review evidence, not a verified merged remedy for this system.
The linked AMD issue 5033 returned an access-denied page, so its current status
was not inferred from the mailing-list thread.

## October 27 candidates

### Skip DSC sequencing when DPMS is off

This patch adds a `stream->dpms_off` early return to
`hwss_add_dsc_sequence_for_stream`. Its rationale concerns state left behind
when migrating legacy DSC logic to block-sequence construction.
[Patch 18/28](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg154328.html).

The guard is absent from the inspected 7.4-rc1 tree. However, the relevant ODM
caller is `dc/hwss/dcn401/dcn401_hwseq.c:1782`. The other caller is shared code:
`dc/core/dc.c:4123`, reached through `add_link_update_dsc_config_sequence` and
`commit_planes_do_stream_update_sequence`. The latter is gated by
`dc->debug.enable_block_sequence_programming` at `dc.c:4334`. A search of the
entire display source finds no assignment enabling that flag in this tree.
DCN314 uses its legacy `update_dsc_on_stream` path instead.

Assessment: no demonstrated active path on the inspected Phoenix configuration.
Its location in a shared file alone does not make it a Phoenix fix. The reviewed
mail establishes submission; a later merged/released status was not verified.

### Adjust DSC slice calculation policy

The new limit is guarded by nonzero
`single_slice_config_throughput_mps`. The patch initializes the capability
structure to zero and assigns the new limit only in `dsc60_get_single_enc_caps`;
the associated clock-manager changes are DCN60-specific.
[Patch 6/28](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg154297.html).

Local verification: DCN314 creates its DSC instances with `dsc2_construct`
(`dc/resource/dcn314/dcn314_resource.c:1793`). The proposed DCN60 limit therefore
does not alter this hardware's slice selection. Assessment: eliminate as a
direct Phoenix fix. Submission was verified; release inclusion was not.

### Reset unused HUBP DET allocations

The original report is a DCN401 compression-buffer assertion caused by stale
VBIOS DET allocations. The new shared helper immediately returns unless
`hubbub->funcs->program_det_segments` exists.
[Patch 14/28](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg154307.html).

Local verification: DCN314 creates a DCN31 hubbub
(`dc/resource/dcn314/dcn314_resource.c:1163` and `:2153`). Its complete callback
table, `dc/hubbub/dcn31/dcn31_hubbub.c:1052`, contains `program_det_size` but no
`program_det_segments`. The proposed helper would return without doing anything
on this hardware. Assessment: eliminate despite the shared core-file location.

Status: included in AMD's November 5 fixes pull and the November 6 DRM fixes
pull targeting 7.4-rc2; the latter starts from 7.4-rc1. This establishes its
presence in the submitted fixes branch, not final release or local activation.
[AMD pull](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg155006.html),
[DRM pull](https://lkml.rescloud.iu.edu/hypermail/linux/kernel/2611.0/20146.html).

AMD's test report for the complete October series includes APU SST DSC 4K144
and GNOME Wayland. It does not identify this Phoenix/M32U combination or our
specific transition, and cannot establish a fix here.
[Upstream test report](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg154774.html).

## Other candidates checked

- **Preserve active ODM during initialization:** the September patch adds
  `is_odm_enabled` explicitly for DCN314. Both the callback
  (`dc/optc/dcn314/dcn314_optc.c:250`) and guarded initialization
  (`dc/hwss/dcn10/dcn10_hwseq.c:1753`) are already present in the failing
  7.4-rc1 source. It addresses initialization, not a proven 120 → 144 defect.
  [Patch](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg150918.html).
- **DCN314 self-refresh Z8 latency:** the September change raises modeled
  exit and combined enter/exit latency to 390 and 601 microseconds. Both values
  already exist at `dc/dml/dcn314/dcn314_fpu.c:153`. The commit description does
  not claim to fix this display transition.
  [Patch thread](https://lore-kernel.gnuweeb.org/amd-gfx/20260924184824.596894-21-jerry.zuo%40amd.com/T/).
- **DCN314 DSC root clock with power gating disabled:** the April patch
  preserves DSC clock enable/disable independently of the power-gating option.
  Its implementation is already present at
  `dc/hwss/dcn314/dcn314_hwseq.c:245` through the end of `dcn314_dsc_pg_control`.
  DCN314's default disables DSC power gating, so this is relevant hardware
  logic, but no longer a missing fix in the inspected kernel.
  [Patch](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg141649.html).
- **Program plane-less ODM formatters:** this September report describes gray
  flashes when disabling another display, but changes only DCN401's ODM
  functions. DCN314 selects its own function. Similar screen color does not
  establish the same bug.
  [Patch](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg152160.html).
- **Atomize IRQ register updates:** this fixes a real high-refresh timeout race
  involving VUPDATE_NO_LOCK. The kernel maintainers identify a fix in 7.3-rc4.
  The inspected 7.4-rc1 implementation also has the spinlock in both
  `amdgpu_dm_irq_set` and `amdgpu_dm_irq_ack`
  (`amdgpu_dm/amdgpu_dm_irq.c:697` and `:706`). It is not a missing fix here.
  [Patch](https://www.mail-archive.com/amd-gfx@lists.freedesktop.org/msg150987.html),
  [kernel maintainers' version record](https://lists.openwall.net/linux-cve-announce/2026/10/18/215).

The two September DCN314 changes also appear in the DRM pull for 7.4-rc1,
consistent with the direct source checks.
[DRM 7.4-rc1 pull](https://lkml.iu.edu/2610.2/14993.html).

## What remains unresolved

The source comparison makes DCN314 ODM/timing/DSC sequencing worth further
static investigation, but supplies no confirmed defective statement or safe
patch. No exact-match public report or firmware release note was found tying
DMUB `0x08006500` and this M32U transition to a known fix. This is a search
limitation, not evidence that none exists.

Keep the distinction between facts and hypotheses: the independent reproducer
removes extension logic from the necessary path, while retaining Mutter and
the same AMD kernel/firmware stack. Determining which transaction or hardware
state first becomes invalid requires evidence beyond matching timeout names.
Any further work under the current authorization should use saved logs,
already captured timings, and source review, leaving the working 120 Hz
session untouched.

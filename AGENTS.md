# My Vision contributor instructions

These instructions apply to this repository and all its subdirectories. Read
them before changing the extension. Preserve existing user changes.

## GNOME review requirements

Use these primary references when implementing or reviewing changes:

- Best practices: https://gjs.guide/extensions/review-guidelines/best-practices.html
- Lifecycle and destruction: https://gjs.guide/extensions/review-guidelines/best-practices.html#lifecycle-and-destruction-state
- Review guidelines: https://gjs.guide/extensions/review-guidelines/
- Compatibility guidance: https://gjs.guide/extensions/upgrading/

Consult the relevant current guidance for lifecycle, asynchronous operations,
Shell APIs, or compatibility changes. Support the Shell versions declared in
`metadata.json`; use documented version differences rather than speculative
optional calls or type checks for guaranteed APIs.

Reviewer feedback on version 16 (2026-09-15) explicitly requested removal of
`this._destroyed`: https://extensions.gnome.org/review/75044
Treat this as an established project requirement, not a stylistic suggestion.

## Lifecycle and asynchronous work

- Do not introduce `_destroyed`, `_enabled`, `_disposed`, or equivalent boolean
  lifecycle guards. Renaming a guard does not solve the underlying problem.
- Each object owns and cleans up its own timers, signal connections,
  cancellables, and child resources.
- In a custom widget `destroy()`, remove active GLib sources, disconnect signal
  handlers, cancel pending work and release child resources/references, then call
  `super.destroy()` last. Non-widget helpers must not call a nonexistent parent
  `destroy()` method.
- Owners must release references to destroyed instances, including references
  held in collections. Do not invoke methods on a destroyed instance.
- Pass `Gio.Cancellable` to asynchronous Gio operations. Capture the operation's
  cancellable locally so completion can check cancellation without accessing an
  owner whose resources have already been released.
- Handle the race where an operation completes just before cancellation but its
  JavaScript continuation runs afterward. Check cancellation before accessing
  owner state after an `await`.
- Cancellation is expected during teardown. It must not trigger notifications,
  settings writes, retries, new signal connections, or replacement timers.
  Audit `catch` and `finally` blocks as well as successful continuations.
- Request serials may reject stale monitor data; they must not serve as a
  substitute destruction flag. Keep legitimate application state, such as an
  in-flight configuration change, distinct from object lifetime.
- Override widget `destroy()` directly rather than connecting a cleanup handler
  to the widget's own `destroy` signal. Keep extension `enable()` and `disable()`
  adjacent for review.

## Other review conventions

- Do not wrap ordinary cleanup APIs in speculative `try/catch` blocks.
- Keep timer replacement/removal next to timer creation.
- Shared modules used by both Shell and preferences must not import `St`,
  `Clutter`, `Gtk`, `Gdk`, or `Adw`. Keep process-specific UI code separate.
- Prefer Gio/D-Bus to subprocesses for extension runtime communication.
- Use standard symbolic icons and clear user-facing messages. Keep implementation
  details out of normal user flows.
- Keep lines within 200 characters and comments focused on non-obvious reasons.

## Preserve profile behavior

- Profile availability requires an exact one-to-one match of the complete set
  of connected physical monitors, including monitors disabled by the profile,
  plus the lid condition. Use this rule for menus, shortcuts, automatic restore,
  and validation before applying. Do not match only the monitors being enabled.
- BuiltIn-only profiles saved with and without an external monitor are distinct
  contexts; preserve both and expose only the matching one. Never fall back to
  another hardware context when no matching profile exists.
- Keep the legacy settings intact as migration backups.
- Preserve stable profile IDs and selections across renames and reordering.
- Duplicate detection must distinguish lid conditions, active monitor assignments,
  modes (including refresh/VRR), layout, and stored properties. Connector
  renumbering and enumeration order must not create duplicates.
- Never arbitrarily match ambiguous monitors or silently substitute a lower
  refresh rate. A closed lid must exclude profiles that activate the built-in
  panel, identified through Mutter's `is-builtin` property.

## Verification and delivery

Run the relevant checks after code changes:

```sh
glib-compile-schemas --strict schemas
GSETTINGS_BACKEND=memory gjs -m tests/profiles.js
gjs -m tests/display-config.js
gjs -m tests/initialization.js
node --test tests/startup.cjs tests/restore.cjs
git diff --check
```

For lifecycle changes, cover cancellation during proxy initialization, monitor
and lid reads, configuration application, and profile saving. Verify that late
completions cannot access released resources or schedule further work.

When a GNOME session is available, `gjs -m tests/live-read-only.js` checks live
state without changing display configuration or writing settings. Distinguish
this from physical open/close, docking, and login testing in the final report.

Build with `bash build.sh -b` in the development environment provided by
`shell.nix`. If producing a delivery ZIP, verify its JavaScript matches the
reviewed sources. Building, installing, loading into the running Shell, and
publishing are separate actions; report accurately which occurred. Do not log
the user out to reload the extension without an explicit instruction.

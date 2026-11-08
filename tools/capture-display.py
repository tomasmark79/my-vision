#!/usr/bin/env python3
"""Read-only display trace outside Shell; no extension reload or settings writes."""
import argparse
from collections import OrderedDict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import time
import uuid


INTERFACE = "org.gnome.Mutter.DisplayConfig"
OBJECT = "/org/gnome/Mutter/DisplayConfig"
RELEVANT = re.compile(r"my.?vision|display|monitor|mutter|amdgpu|drm|kms|gpu|page.?flip|atomic|link.?train|JS ERROR|JS WARNING", re.I)
USB_EVENT = re.compile(r"typec|thunderbolt|usb.*(?:disconnect|new .*device)", re.I)


def relevant_journal(entry):
    message = entry.get("MESSAGE", "")
    if not isinstance(message, str):
        return False
    if entry.get("_TRANSPORT") == "kernel":
        return bool(RELEVANT.search(message) or USB_EVENT.search(message))
    component = entry.get("_COMM", "").lstrip(".")
    return component.startswith(("gnome-shell", "xdg-desktop-po", "gnome-control-c", "gsd-power", "gsd-xrandr", "upowerd")) and bool(RELEVANT.search(message))


class DisplayMessages:
    """Only save Apply calls, their replies and display signals, including bodies."""

    def __init__(self):
        self.pending = OrderedDict()
        self.selected = False

    def include(self, line):
        if line.startswith(("method call ", "method return ", "error ", "signal ")):
            fields = dict(re.findall(r"([\w_]+)=([^\s;]+)", line))
            display = fields.get("interface") == INTERFACE
            self.selected = False
            if line.startswith("method call ") and display and fields.get("member") == "ApplyMonitorsConfig":
                self.pending[(fields.get("sender"), fields.get("serial"))] = None
                # Bound storage even if the compositor never replies.
                if len(self.pending) > 1024:
                    self.pending.popitem(last=False)
                self.selected = True
            elif line.startswith(("method return ", "error ")):
                key = (fields.get("destination"), fields.get("reply_serial"))
                if key in self.pending:
                    del self.pending[key]
                    self.selected = True
            elif line.startswith("signal ") and display:
                self.selected = True
        return self.selected


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def command(arguments):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=4)
        return {"code": result.returncode, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"error": str(error)}


def dbus(bus, destination, path, method, *arguments):
    return command(["gdbus", "call", bus, "--dest", destination, "--object-path", path,
                    "--method", method, *arguments])


def hardware():
    connectors = {}
    for path in sorted(Path("/sys/class/drm").glob("card*-*")):
        values = {}
        for key in ("status", "enabled", "dpms"):
            try:
                values[key] = (path / key).read_text().strip()
            except FileNotFoundError:
                pass  # A connector can disappear during USB-C hotplug.
            except OSError as error:
                values[key] = str(error)
        connectors[path.name] = values
    return connectors


def state():
    return {
        "mutter": dbus("--session", INTERFACE, OBJECT, INTERFACE + ".GetCurrentState"),
        "lid": dbus("--system", "org.freedesktop.UPower", "/org/freedesktop/UPower",
                    "org.freedesktop.DBus.Properties.GetAll", "org.freedesktop.UPower"),
        "connectors": hardware(),
    }


def destination(args):
    root = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "my-vision/diagnostics"
    if args.output:
        return Path(args.output).expanduser().resolve(), root
    if args.action == "record":
        return root / datetime.now().strftime("%Y%m%d-%H%M%S-%f"), root
    latest = root / "latest"
    if not latest.is_symlink():
        raise SystemExit("No capture found. Start with: python3 tools/capture-display.py record")
    return latest.resolve(strict=True), root


def record(args, output, root):
    for name in ("dbus-monitor", "gdbus", "journalctl", "gnome-extensions"):
        if not shutil.which(name):
            raise SystemExit(f"Missing command: {name}")
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    root.mkdir(parents=True, mode=0o700, exist_ok=True)
    temporary = root / ("latest-" + uuid.uuid4().hex)
    temporary.symlink_to(output)
    temporary.replace(root / "latest")
    children = []
    selector = selectors.DefaultSelector()
    buffers = {}
    messages = DisplayMessages()
    stop = []
    handlers = {sig: signal.signal(sig, lambda *_: stop.append(True)) for sig in (signal.SIGTERM, signal.SIGINT)}
    deadline = time.monotonic() + args.duration
    previous = None
    seen_markers = set()
    with (output / "trace.jsonl").open("x") as trace:
        def emit(kind, value):
            trace.write(json.dumps({"time": now(), "monotonic": time.monotonic(), "kind": kind, "data": value}) + "\n")
            trace.flush()

        def watch(name, arguments):
            child = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            children.append(child)
            selector.register(child.stdout, selectors.EVENT_READ, name)
            buffers[name] = b""

        try:
            watch("dbus", ["dbus-monitor", "--session",
                           f"type='method_call',interface='{INTERFACE}',member='ApplyMonitorsConfig'",
                           f"type='signal',interface='{INTERFACE}'",
                           f"type='method_return',sender='{INTERFACE}'",
                           f"type='error',sender='{INTERFACE}'"])
            watch("journal", ["journalctl", "--follow", "--lines=0", "--output=json", "--no-pager"])
            emit("start", {"pid": os.getpid(), "duration": args.duration,
                           "extension": command(["gnome-extensions", "info", "my-vision@digitalspace.name"]),
                           "kernel": command(["uname", "-r"]),
                           "shell_owner": dbus("--session", "org.freedesktop.DBus", "/org/freedesktop/DBus",
                                               "org.freedesktop.DBus.GetNameOwner", INTERFACE)})
            # Read only the installed schema, without compiling or changing it.
            schemas = Path.home() / ".local/share/gnome-shell/extensions/my-vision@digitalspace.name/schemas"
            for key in ("profiles-v2", "configs"):
                emit("saved-" + key, command(["gsettings", "--schemadir", str(schemas), "get",
                                             "org.gnome.shell.extensions.my-vision", key]))
            print(f"Recording: {output}\nMark a failure: python3 tools/capture-display.py mark gray-screen\n"
                  "Stop: python3 tools/capture-display.py stop", flush=True)
            next_snapshot = 0
            while not stop and time.monotonic() < deadline and not (output / "STOP").exists():
                markers = set(output.glob("mark-*.json")) - seen_markers
                if markers:
                    for marker in sorted(markers):
                        emit("marker", json.loads(marker.read_text()))
                    seen_markers.update(markers)
                    next_snapshot = 0
                for key, _ in selector.select(timeout=0.2):
                    name = key.data
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        emit("collector-failed", name)
                        raise RuntimeError(f"{name} collector exited; trace is incomplete")
                    buffers[name] += chunk
                    while b"\n" in buffers[name]:
                        raw, buffers[name] = buffers[name].split(b"\n", 1)
                        line = raw.decode("utf-8", errors="replace")
                        if name == "dbus":
                            if messages.include(line):
                                emit("dbus", line)
                                if line.startswith(("method call ", "signal ")):
                                    next_snapshot = 0
                            elif line.startswith("dbus-monitor:"):
                                emit("collector-message", line)
                        else:
                            try:
                                entry = json.loads(line)
                            except ValueError:
                                emit("journal-access", line)
                                continue
                            if relevant_journal(entry):
                                emit("journal", {k: entry.get(k) for k in
                                                 ("__REALTIME_TIMESTAMP", "__MONOTONIC_TIMESTAMP", "_BOOT_ID", "_TRANSPORT", "_COMM", "_PID", "MESSAGE")})
                if time.monotonic() >= next_snapshot:
                    snapshot = state()
                    if snapshot != previous or markers:
                        emit("state", snapshot)
                        previous = snapshot
                    next_snapshot = time.monotonic() + 2
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
            for child in children:
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                child.stdout.close()
            selector.close()
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
            emit("stop", {"pending_apply_replies": len(messages.pending)})
            (output / "finished").write_text(now() + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("record", "mark", "stop"))
    parser.add_argument("label", nargs="?", default="gray-screen")
    parser.add_argument("--output", help="capture directory (defaults to a new directory, or the latest capture)")
    parser.add_argument("--duration", type=int, default=1800, help="maximum recording seconds (default: 1800)")
    args = parser.parse_args()
    if args.duration < 1:
        parser.error("--duration must be positive")
    os.umask(0o077)
    output, root = destination(args)
    if args.action == "record":
        record(args, output, root)
    else:
        if not output.is_dir() or (output / "finished").exists():
            raise SystemExit("This capture is not running; start a new recording.")
        if args.action == "mark":
            marker = output / ("mark-" + uuid.uuid4().hex + ".json")
            temporary = marker.with_suffix(".tmp")
            temporary.write_text(json.dumps({"time": now(), "monotonic": time.monotonic(), "label": args.label}))
            temporary.replace(marker)
            print(f"Marked {args.label}: {output}")
        else:
            (output / "STOP").touch()
            print(f"Stop requested: {output}")


if __name__ == "__main__":
    main()

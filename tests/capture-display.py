"""Correlation checks: never retain unrelated Shell method replies."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "capture_display", Path(__file__).resolve().parents[1] / "tools/capture-display.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class DisplayMessagesTest(unittest.TestCase):
    def test_correlates_by_caller_and_serial(self):
        messages = capture.DisplayMessages()
        call = ("method call time=1 sender=:1.7 -> destination=org.gnome.Mutter.DisplayConfig serial=42 "
                "path=/org/gnome/Mutter/DisplayConfig; interface=org.gnome.Mutter.DisplayConfig; member=ApplyMonitorsConfig")
        self.assertTrue(messages.include(call))
        self.assertTrue(messages.include("   uint32 10"))
        self.assertFalse(messages.include("method return time=2 sender=:1.7 -> destination=:1.99 serial=10 reply_serial=42"))
        self.assertFalse(messages.include('   string "unrelated data"'))
        self.assertTrue(messages.include("method return time=3 sender=:1.7 -> destination=:1.7 serial=11 reply_serial=42"))
        self.assertTrue(messages.include("   uint32 1"))
        self.assertFalse(messages.include("method return time=4 sender=:1.7 -> destination=:1.7 serial=12 reply_serial=42"))

    def test_error_reply_and_signal(self):
        messages = capture.DisplayMessages()
        self.assertTrue(messages.include(
            "method call time=1 sender=:1.4 -> destination=:1.7 serial=5 "
            "interface=org.gnome.Mutter.DisplayConfig; member=ApplyMonitorsConfig"))
        self.assertTrue(messages.include(
            "error time=2 sender=:1.7 -> destination=:1.4 error_name=org.freedesktop.DBus.Error.AccessDenied reply_serial=5"))
        self.assertTrue(messages.include('   string "stale serial"'))
        self.assertTrue(messages.include(
            "signal time=3 sender=:1.7 -> destination=(null destination) serial=6 "
            "interface=org.gnome.Mutter.DisplayConfig; member=MonitorsChanged"))
        self.assertFalse(messages.include(
            "signal time=4 sender=org.freedesktop.DBus -> destination=:1.9 serial=1 interface=org.freedesktop.DBus; member=NameLost"))


class JournalMessagesTest(unittest.TestCase):
    def test_limits_messages_to_display_components(self):
        self.assertTrue(capture.relevant_journal({"_TRANSPORT": "kernel", "MESSAGE": "amdgpu flip_done timed out"}))
        self.assertTrue(capture.relevant_journal({"_TRANSPORT": "kernel", "MESSAGE": "usb 7-1: USB disconnect, device number 77"}))
        self.assertTrue(capture.relevant_journal({"_COMM": ".gnome-shell-wr", "MESSAGE": "Failed to apply display profile"}))
        self.assertTrue(capture.relevant_journal({"_COMM": ".xdg-desktop-po", "MESSAGE": "Monitor has no configuration which is-current!"}))
        self.assertFalse(capture.relevant_journal({"_COMM": "systemd", "MESSAGE": "backup-monitor.service: Failed"}))
        self.assertFalse(capture.relevant_journal({"_TRANSPORT": "kernel", "MESSAGE": "Unrelated kernel event"}))


if __name__ == "__main__":
    unittest.main()

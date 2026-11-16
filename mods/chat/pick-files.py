#!/usr/bin/env python3
# The desktop's own file picker (xdg-desktop-portal FileChooser), several files at once, for the
# chat's attach button: prints each chosen path on its own line; nothing when cancelled.
# Herdr's mods have a folder picker only (pickFolder), so the chat runs this.
import sys
from urllib.parse import unquote, urlparse

# Local patch (2026-11-05): macOS has no xdg-desktop-portal; use the system's own picker through
# osascript ("choose file", several at once). Cancel (-128) prints nothing, like the portal's.
if sys.platform == "darwin":
    import subprocess

    title = sys.argv[1] if len(sys.argv) > 1 else "Attach files"
    script = [
        "on run argv",
        "set fs to choose file with prompt (item 1 of argv) with multiple selections allowed",
        'set out to ""',
        "repeat with f in fs",
        "set out to out & POSIX path of f & linefeed",
        "end repeat",
        "return out",
        "end run",
    ]
    args = ["osascript"] + [a for line in script for a in ("-e", line)] + [title]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.strip("\n"))
        sys.exit(0)
    if "-128" in r.stderr:
        sys.exit(0)
    sys.stderr.write(r.stderr)
    sys.exit(1)

from gi.repository import Gio, GLib

title = sys.argv[1] if len(sys.argv) > 1 else "Attach files"
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = f"herdr_chat_{GLib.random_int()}"
sender = bus.get_unique_name()[1:].replace(".", "_")
path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
loop = GLib.MainLoop()
chosen = []


def response(_bus, _sender, _path, _iface, _signal, params):
    code, results = params.unpack()
    if code == 0:
        for uri in results.get("uris", []):
            u = urlparse(uri)
            if u.scheme == "file":
                chosen.append(unquote(u.path))
    loop.quit()


# Listen before asking, so the answer can't come first.
bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response",
                     path, None, Gio.DBusSignalFlags.NONE, response)
bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
              "org.freedesktop.portal.FileChooser", "OpenFile",
              GLib.Variant("(ssa{sv})", ("", title, {
                  "handle_token": GLib.Variant("s", token),
                  "multiple": GLib.Variant("b", True),
                  "accept_label": GLib.Variant("s", "Attach"),
              })), GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None)
loop.run()
print("\n".join(chosen))

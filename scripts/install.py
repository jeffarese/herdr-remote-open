#!/usr/bin/env python3
"""The part of installing remote-open that edits the person's layouts.

    install.py layouts add [NAME...]      put the watcher (an invisible floating block that
                                          shows forwarded ports), the terminal menu and the
                                          link handler (Cmd-clicks in terminals) into personal
                                          layouts, or only the ones named
    install.py layouts remove [NAME...]   take them out again (the menu only if still ours)

The app's home is ~/.config/herdr-app, or $HERDR_APP_HOME. Herdr's own layouts are never
edited. A changed layout keeps its old file beside it as <name>.json.before-remote-open.
"""
import json
import os
from pathlib import Path
import sys

APP_HOME = Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app"))
MOD = "remote-open"
BLOCK = {"id": "remote-open", "content": {"mod": MOD}, "edge": "bottom", "align": "center"}


def write_json(path, value):
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def shipped():
    try:
        return {k[len("layout:"):] for k in json.loads((APP_HOME / "installed.json").read_text()) if k.startswith("layout:")}
    except (OSError, ValueError):
        return {"main", "terminals", "win98"}


def ours(node):
    content = node.get("content") if isinstance(node, dict) else None
    return isinstance(content, dict) and content.get("mod") == MOD


def add(layout):
    """True when it changed. Notes go to stdout."""
    changed = False
    floating = layout.get("floating")
    if not isinstance(floating, list):
        floating = []
    if not any(ours(f) for f in floating):
        layout["floating"] = floating + [dict(BLOCK)]
        changed = True
    menu = layout.get("terminal_menu")
    if menu in (None, "", "menu"):
        layout["terminal_menu"] = MOD
        changed = True
    elif menu != MOD:
        print(f"  its terminal menu is {menu!r}, so the image items aren't added there")
    # First, so a mod that takes every link doesn't get another machine's localhost ones: ours
    # passes on whatever isn't its own. Where it already is (Herdr adds it itself the first time
    # it sees the mod), it stays.
    handlers = layout.get("link_handlers")
    if not isinstance(handlers, list):
        handlers = []
    if MOD not in handlers:
        layout["link_handlers"] = [MOD] + handlers
        changed = True
    return changed


def remove(layout):
    changed = False
    floating = layout.get("floating")
    if isinstance(floating, list):
        rest = [f for f in floating if not ours(f)]
        if len(rest) != len(floating):
            changed = True
            if rest:
                layout["floating"] = rest
            else:
                del layout["floating"]
    if layout.get("terminal_menu") == MOD:
        del layout["terminal_menu"]
        changed = True
    handlers = layout.get("link_handlers")
    if isinstance(handlers, list) and MOD in handlers:
        rest = [h for h in handlers if h != MOD]
        if rest:
            layout["link_handlers"] = rest
        else:
            del layout["link_handlers"]
        changed = True
    return changed


def layouts(action, names=()):
    herdrs = shipped()
    found = set()
    for path in sorted((APP_HOME / "layouts").glob("*.json")):
        if names and path.stem not in names:
            continue
        found.add(path.stem)
        if path.stem in herdrs:
            if names:
                print(f"Skipped {path.stem}: it is one of Herdr's own layouts.")
            continue
        try:
            layout = json.loads(path.read_text())
        except (OSError, ValueError):
            print(f"Skipped {path.name}: not valid JSON right now.")
            continue
        if not isinstance(layout, dict):
            continue
        before = path.read_text()
        if (add if action == "add" else remove)(layout):
            # The backup is the layout before remote-open first went in: removing keeps it.
            backup = path.with_name(f"{path.name}.before-{MOD}")
            if action == "add" or not backup.exists():
                backup.write_text(before)
            write_json(path, layout)
            print(f"{'Added remote-open to' if action == 'add' else 'Took remote-open out of'} {path.stem}.")
    missing = [n for n in names if n not in found]
    if missing:
        print(f"No such layout: {', '.join(missing)}.")
        return False
    return True


def main(argv):
    if argv[:1] == ["layouts"] and argv[1:2] in (["add"], ["remove"]):
        return 0 if layouts(argv[1], tuple(argv[2:])) else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Edits the showcase stage's layout and prints it: the right-click menu shown as a floating
block over the pane (a pointer popup can't be opened without a pointer), and taken away again.

    python3 layout.py <layout.json> menu <pane id> <terminal address>
    python3 layout.py <layout.json> nomenu
"""
import json
import sys

MENU_ID = "remote-open-menu-demo"


def nodes(node):
    yield node
    for key in ("children", "tabs"):
        for child in node.get(key) or []:
            yield from nodes(child)


def main(path, op, *args):
    layout = json.load(open(path))
    main_node = next(n for n in nodes(layout) if n.get("id") == "main")
    if op == "menu":
        pane, terminal = args
        entry = {"id": MENU_ID, "content": {"mod": "remote-open", "props": {"tab": "pane", "target": {"pane": pane, "terminal": terminal}}}, "edge": "top", "align": "center"}
        main_node["floating"] = [f for f in main_node.get("floating") or [] if f.get("id") != MENU_ID] + [entry]
    elif op == "nomenu":
        main_node["floating"] = [f for f in main_node.get("floating") or [] if f.get("id") != MENU_ID]
        if not main_node["floating"]:
            del main_node["floating"]
    json.dump(layout, sys.stdout)


if __name__ == "__main__":
    main(*sys.argv[1:])

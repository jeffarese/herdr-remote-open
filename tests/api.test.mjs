// Every builder method the views call exists in the gpui-kit Herdr ships, and none that needs
// an argument is called without one. Skipped where no gpui-kit.d.ts is around (CI).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { methods, nodes } from "gpui-kit";
import * as views from "../mods/remote-open/views.js";

const candidates = [new URL("../mods/remote-open/gpui-kit.d.ts", import.meta.url).pathname, `${process.env.HERDR_APP_HOME ?? `${homedir()}/.config/herdr-app`}/gpui-kit.d.ts`];
const dts = candidates.find((p) => existsSync(p));
const act = new Proxy({}, { get: () => () => {} });
const handle = { focus() {} };

test("the views only call methods gpui-kit has", { skip: !dts && "no gpui-kit.d.ts here" }, () => {
  const source = readFileSync(dts, "utf8");
  const known = new Set([...source.matchAll(/^\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/gm)].map((m) => m[1]));
  const img = { file: "data/remote-open/cache/a.png", name: "a.png", machine: "studio", path: "/a.png", w: 800, h: 600 };
  const fw = [
    { port: 8085, machine: "studio", until: Date.now() + 300_000 },
    { port: 5173, machine: "studio", until: null },
  ];
  const trees = [
    views.viewer({ props: img, fit: true, body: { width: 500, height: 400 }, note: null, handle, barHeight: 36, act }),
    views.viewer({ props: { ...img, w: null, h: null, machine: null }, fit: false, body: null, note: "Copied", handle, barHeight: 36, act }),
    views.menu({ items: [{ label: "Open a.png", image: true, busy: true }, { label: "Zoom", icon: "square", sep: true, hint: "⌘Z" }], at: 0, handle, act }),
    views.chip({ forwards: [], act }),
    views.chip({ forwards: fw.slice(0, 1), act }),
    views.chip({ forwards: fw, act }),
    views.forwardsList({ forwards: fw, now: Date.now(), handle, act }),
    views.forwardsList({ forwards: [], now: Date.now(), handle, act }),
  ];
  const used = new Set();
  for (const tree of trees) for (const name of methods(tree)) used.add(name);
  assert.deepEqual([...used].filter((name) => !known.has(name)).sort(), [], `not in ${dts}`);

  const needs = new Map();
  for (const [, name, params] of source.matchAll(/^\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm)) {
    const required = params.split(",").map((p) => p.trim()).filter((p) => p && !p.startsWith("this") && !p.startsWith("...") && !/^\w+\?/.test(p));
    needs.set(name, (needs.get(name) ?? true) && required.length > 0);
  }
  const bare = new Set();
  for (const tree of trees) for (const n of nodes(tree)) for (const [name, ...args] of n.calls ?? []) if (args.length === 0 && needs.get(name)) bare.add(name);
  assert.deepEqual([...bare].sort(), [], "called without the argument gpui-kit requires");
});

test("the chip draws nothing while no port is forwarded", () => {
  const idle = views.chip({ forwards: [], act });
  assert.equal(idle.kids.length, 0);
  assert.equal(idle.idValue, "ro-idle");
});

test("the forwards list is as tall as its rows", () => {
  assert.equal(views.forwardsHeight(1) - views.forwardsHeight(0), views.FORWARD_ROW);
  assert.equal(views.forwardsHeight(2) - views.forwardsHeight(1), views.FORWARD_ROW + 9 + views.MENU_ROW);
});

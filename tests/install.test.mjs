import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/install.py", import.meta.url).pathname;
const py = (home, ...args) => spawnSync("python3", ["-I", script, ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, HERDR_APP_HOME: home } });

function appHome() {
  const home = mkdtempSync(join(tmpdir(), "remote-open-app-"));
  mkdirSync(join(home, "layouts"));
  writeFileSync(join(home, "installed.json"), JSON.stringify({ "layout:main": "x" }));
  writeFileSync(join(home, "layouts/main.json"), JSON.stringify({ id: "root" }));
  writeFileSync(join(home, "layouts/mine.json"), JSON.stringify({ id: "root", floating: [{ id: "toasts", content: { mod: "agent-toast" } }] }));
  writeFileSync(join(home, "layouts/menu.json"), JSON.stringify({ id: "root", terminal_menu: "my-menu" }));
  return home;
}

const load = (home, name) => JSON.parse(readFileSync(join(home, "layouts", `${name}.json`), "utf8"));

test("personal layouts get the watcher and the menu; Herdr's own and other menus don't", () => {
  const home = appHome();
  const r = py(home, "layouts", "add");
  assert.equal(r.status, 0, r.stderr);
  const mine = load(home, "mine");
  assert.deepEqual(mine.floating.map((f) => f.id), ["toasts", "remote-open"]);
  assert.equal(mine.terminal_menu, "remote-open");
  assert.deepEqual(mine.link_handlers, ["remote-open"]);
  assert.ok(existsSync(join(home, "layouts/mine.json.before-remote-open")));
  assert.deepEqual(load(home, "main"), { id: "root" });
  assert.equal(load(home, "menu").terminal_menu, "my-menu");
  assert.match(r.stdout, /terminal menu is 'my-menu'/);

  // Again: nothing changes.
  const before = readFileSync(join(home, "layouts/mine.json"), "utf8");
  py(home, "layouts", "add");
  assert.equal(readFileSync(join(home, "layouts/mine.json"), "utf8"), before);

  const original = readFileSync(join(home, "layouts/mine.json.before-remote-open"), "utf8");
  assert.equal(py(home, "layouts", "remove").status, 0);
  assert.deepEqual(load(home, "mine"), { id: "root", floating: [{ id: "toasts", content: { mod: "agent-toast" } }] });
  assert.equal(readFileSync(join(home, "layouts/mine.json.before-remote-open"), "utf8"), original, "the backup is still the layout before remote-open");
  assert.equal(load(home, "menu").terminal_menu, "my-menu");
  rmSync(home, { recursive: true });
});

test("named layouts only: the others stay as they were, and a wrong name says so", () => {
  const home = appHome();
  writeFileSync(join(home, "layouts/other.json"), JSON.stringify({ id: "root" }));
  const r = py(home, "layouts", "add", "mine", "main", "nope");
  assert.equal(r.status, 1);
  assert.equal(load(home, "mine").terminal_menu, "remote-open");
  assert.deepEqual(load(home, "other"), { id: "root" });
  assert.deepEqual(load(home, "main"), { id: "root" });
  assert.match(r.stdout, /Skipped main: it is one of Herdr's own layouts/);
  assert.match(r.stdout, /No such layout: nope/);
  rmSync(home, { recursive: true });
});

test("the link handler goes first among a layout's, stays where it was put, and comes out alone", () => {
  const home = appHome();
  writeFileSync(join(home, "layouts/links.json"), JSON.stringify({ id: "root", link_handlers: ["my-browser"] }));
  writeFileSync(join(home, "layouts/placed.json"), JSON.stringify({ id: "root", link_handlers: ["my-browser", "remote-open"] }));
  assert.equal(py(home, "layouts", "add").status, 0);
  assert.deepEqual(load(home, "links").link_handlers, ["remote-open", "my-browser"]);
  assert.deepEqual(load(home, "placed").link_handlers, ["my-browser", "remote-open"]);
  assert.equal(py(home, "layouts", "remove").status, 0);
  assert.deepEqual(load(home, "links").link_handlers, ["my-browser"]);
  assert.deepEqual(load(home, "placed").link_handlers, ["my-browser"]);
  assert.equal("link_handlers" in load(home, "mine"), false);
  rmSync(home, { recursive: true });
});

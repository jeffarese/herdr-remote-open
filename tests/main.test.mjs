// The copies main.js makes, driven through the stubbed host: the watcher answering requests,
// the menu, the viewer and the forwards list.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "herdr";
import { text, byId } from "gpui-kit";
import { disk } from "./stubs/fs.mjs";
import { listeners } from "./stubs/net.mjs";
import RemoteOpen, { _state } from "../mods/remote-open/main.js";
import * as m from "../mods/remote-open/model.js";
import * as hostjs from "../mods/remote-open/host.js";

// The start of a PNG of w×h: enough for model.imageSize.
function png(w, h) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(w, 16);
  bytes.writeUInt32BE(h, 20);
  return bytes;
}

// A cx whose spawned tasks the test can wait for, with sleeps that pass at once.
function makeCx() {
  const tasks = [];
  const timers = [];
  const cx = {
    opened: [],
    notified: 0,
    spawn(fn) {
      const p = Promise.resolve().then(() => fn(cx));
      tasks.push(p);
      return p;
    },
    sleep: async () => {},
    notify() {
      cx.notified++;
    },
    open_url(url) {
      cx.opened.push(url);
    },
    clipboard: null,
    write_to_clipboard(t) {
      cx.clipboard = t;
    },
    focus_handle: () => ({ focus() {} }),
    stop_propagation() {},
    timer: { every: (ms, fn) => timers.push(fn) },
    // A copy waiting for its next key command never settles: each round waits for the rest.
    async settle() {
      for (let i = 0; i < 20; i++) await Promise.race([Promise.allSettled(tasks.splice(0)), new Promise((r) => setTimeout(r, 20))]);
    },
    async tick() {
      for (const fn of timers) fn(cx);
      await cx.settle();
    },
  };
  return cx;
}

const labelsOf = (address) => world.terminals.find((t) => t.address === address).labels;

// hc and exec as Herdr would answer them, with labels kept on world.terminals.
function host({ idle = 0, machines = [{ name: "studio", target: "studio-sandbox", via: false, state: "connected" }], wc = "", b64 = "" } = {}) {
  world.hcs = [];
  world.execs = [];
  world.notes = [];
  world.overlays = [];
  world.closed = [];
  world.present = null;
  world.history = null;
  world.hc = async (args) => {
    if (args[0] === "label") {
      const labels = labelsOf(args[1]);
      for (const kv of args.slice(2)) {
        const i = kv.indexOf("=");
        if (kv.slice(i + 1)) labels[kv.slice(0, i)] = kv.slice(i + 1);
        else delete labels[kv.slice(0, i)];
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ address: args[1], labels: labelsOf(args[1]) }), stderr: "" };
    if (args[0] === "machine") return { code: 0, stdout: JSON.stringify({ machines }), stderr: "" };
    if (args[0] === "read") return { code: 0, stdout: (args[3] !== "0" ? world.history : null) ?? world.screen ?? "", stderr: "" };
    return { code: 1, stdout: "", stderr: "?" };
  };
  world.exec = async (cmd, args) => {
    if (cmd === "/bin/hostname") return { code: 0, stdout: "mac-a.local\n", stderr: "" };
    if (cmd === "/usr/sbin/ioreg") return { code: 0, stdout: `"HIDIdleTime" = ${idle * 1e6}\n`, stderr: "" };
    if (cmd === "/bin/sh" && args[0] === "-c" && args[1].includes("/usr/bin/ssh")) return { code: 0, stdout: "", stderr: "" };
    if (cmd === "/bin/sh" && args[0] === "-c" && args[1].includes("for f do")) {
      // With world.present, the files there: the ones asked about, in the order asked.
      if (!world.present) return { code: 0, stdout: world.existing ?? "", stderr: "" };
      const [, , , cwd, ...asked] = args;
      const out = asked.map((f) => (f.startsWith("/") ? f : `${cwd}/${f}`)).filter((f) => world.present.has(f));
      return { code: 0, stdout: out.map((f) => `${f}\n`).join(""), stderr: "" };
    }
    // A tile's picture: a 480×300 PNG where sips was told to put it.
    if (cmd === "/usr/bin/sips") {
      disk.set(args.at(-1), png(480, 300));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "/usr/bin/ssh") return { code: 0, stdout: "", stderr: "" };
    if (cmd === "/bin/sh" && args[1].includes("wc -c")) return { code: 0, stdout: wc, stderr: "" };
    if (cmd === "/bin/sh" && args[1].includes("base64")) return { code: 0, stdout: b64, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

const request = (id, arg, cwd = "/home/sandbox") => JSON.stringify({ v: 1, id, t: Date.now(), arg, cwd });
// What herdr-open does: one request label, under its id.
const ask = (address, id, arg) => (labelsOf(address)[m.reqKey(id)] = request(id, arg));
// The acks this Mac wrote, as hc saw them.
const acksBy = (address, id) => world.hcs.filter((a) => a[0] === "label" && a[1] === address && a[2] === `${m.ackKey(id)}=${_state.me}`).length;

// Each test's watcher starts as the only one, as after a reload.
async function watcher() {
  Object.assign(_state, { owner: null, beat: 0, inbox: [], lastUse: 0, wasActive: false, keys: new Map() });
  world.props = {};
  const cx = makeCx();
  const w = new RemoteOpen();
  w.init({}, cx);
  await cx.settle();
  return { w, cx };
}

test("a request there before the watcher started is left alone, however long it stays", async () => {
  host();
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t5", labels: {} }];
  ask("studio/t5", "aaaa00000001", "https://example.com/");
  const { cx } = await watcher();
  await cx.tick();
  // Ten minutes on, the label (a killed herdr-open's) is still there: still not answered.
  _state.seen.set("aaaa00000001", { first: Date.now() - 700_000, last: Date.now() - 700_000 });
  await cx.tick();
  assert.deepEqual(cx.opened, []);
  assert.equal(labelsOf("studio/t5")[m.ackKey("aaaa00000001")], undefined);
});

test("the window in use takes a page and opens it here", async () => {
  host({ idle: 1000 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t5", labels: {} }];
  const { cx } = await watcher();
  assert.match(_state.me, /^mac-a-[0-9a-f]{6}$/, "host name and a tag kept per install");
  ask("studio/t5", "aaaa00000002", "https://example.com/docs");
  await cx.tick();
  assert.equal(acksBy("studio/t5", "aaaa00000002"), 1);
  assert.deepEqual(cx.opened, ["https://example.com/docs"]);
  assert.equal(Object.keys(labelsOf("studio/t5")).some((k) => k.startsWith(m.BID)), false, "its bid is taken off again");
});

test("two requests at once on one terminal are both answered", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t13", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t13", "aaaa00000010", "https://example.com/a");
  ask("studio/t13", "aaaa00000011", "https://example.com/b");
  await cx.tick();
  assert.deepEqual(cx.opened.sort(), ["https://example.com/a", "https://example.com/b"]);
});

test("a sign-in forwards its callback port for ten minutes, then opens", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t6", labels: {} }];
  const { cx } = await watcher();
  const url = "https://accounts.example/auth?redirect_uri=http%3A%2F%2Flocalhost%3A8085%2F";
  ask("studio/t6", "aaaa00000003", url);
  await cx.tick();
  const ssh = world.execs.find(([cmd, args]) => cmd === "/bin/sh" && args[1].includes("/usr/bin/ssh"));
  assert.ok(ssh, "ssh ran");
  const argv = ssh[1].slice(4);
  assert.deepEqual(argv.slice(argv.indexOf("-L"), argv.indexOf("-L") + 2), ["-L", "127.0.0.1:8085:localhost:8085"]);
  assert.deepEqual(argv.slice(argv.indexOf("--")), ["--", "studio-sandbox", "sleep", "600"]);
  assert.equal(argv.includes("-N"), false);
  assert.deepEqual(cx.opened, [url]);
  assert.equal(world.notes.at(-1).title, "Sign-in opened here");
  const rec = hostjs.forwards().find((r) => r.port === 8085);
  assert.equal(rec.pending, false);
  assert.equal(JSON.parse(disk.get([...disk.keys()].find((k) => k.endsWith("/forwards.json")))).find((r) => r.port === 8085).pending, false);
});

test("a port already taken on this Mac stops the page from opening", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t7", labels: {} }];
  listeners.add("127.0.0.1:5173");
  try {
    const { cx } = await watcher();
    ask("studio/t7", "aaaa00000004", "http://localhost:5173/");
    await cx.tick();
    assert.deepEqual(cx.opened, []);
    assert.match(world.notes.at(-1).body, /5173 is already in use/);
  } finally {
    listeners.delete("127.0.0.1:5173");
  }
});

test("two requests for one port start one forward", async () => {
  host();
  const want = { machine: "studio", target: "studio-sandbox", port: 5174, host: "localhost", auth: false };
  const sleep = () => new Promise((r) => setTimeout(r, 1));
  const [a, b] = await Promise.all([hostjs.ensureForward(want, sleep), hostjs.ensureForward(want, sleep)]);
  const starts = world.execs.filter(([cmd, args]) => cmd === "/bin/sh" && args[1].includes("/usr/bin/ssh") && args.includes("127.0.0.1:5174:localhost:5174"));
  assert.equal(starts.length, 1);
  assert.equal(a.record.port, 5174);
  assert.equal(b.reused, true);
  await hostjs.stopForward(a.record);
});

test("a window not in front bids, and stands down when another window acked", async () => {
  host();
  world.window = { platform: "macos", active: false };
  world.terminals = [{ address: "studio/t8", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t8", "aaaa00000005", "https://example.com/");
  // The other Mac answers while this one waits.
  const label = world.hc;
  world.hc = async (args) => {
    const r = await label(args);
    if (args[0] === "label" && args[2].startsWith(m.bidKey("aaaa00000005", _state.me))) labelsOf("studio/t8")[m.ackKey("aaaa00000005")] = "mac-b";
    return r;
  };
  await cx.tick();
  assert.ok(world.hcs.some((a) => a[2]?.startsWith(`${m.bidKey("aaaa00000005", _state.me)}=`)), "it bid");
  assert.equal(acksBy("studio/t8", "aaaa00000005"), 0);
  assert.equal(labelsOf("studio/t8")[m.ackKey("aaaa00000005")], "mac-b");
  assert.deepEqual(cx.opened, []);
});

test("when two Macs ack at the same moment, only the one the label keeps opens it", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t14", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t14", "aaaa00000012", "https://example.com/");
  const label = world.hc;
  world.hc = async (args) => {
    const r = await label(args);
    // mac-b's ack lands just after this Mac's.
    if (args[0] === "label" && args[2] === `${m.ackKey("aaaa00000012")}=${_state.me}`) labelsOf("studio/t14")[m.ackKey("aaaa00000012")] = "mac-b";
    return r;
  };
  await cx.tick();
  assert.equal(acksBy("studio/t14", "aaaa00000012"), 1, "it did ack");
  assert.deepEqual(cx.opened, [], "but mac-b's ack was the last");
});

test("a request herdr-open gave up on (ack \"-\") or took back is left alone", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t15", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t15", "aaaa00000013", "https://example.com/1");
  labelsOf("studio/t15")[m.ackKey("aaaa00000013")] = "-";
  await cx.tick();
  const label = world.hc;
  world.hc = async (args) => {
    const r = await label(args);
    if (args[0] === "label" && args[2].startsWith(m.BID)) delete labelsOf("studio/t15")[m.reqKey("aaaa00000014")];
    return r;
  };
  ask("studio/t15", "aaaa00000014", "https://example.com/2");
  await cx.tick();
  assert.deepEqual(cx.opened, []);
  assert.equal(acksBy("studio/t15", "aaaa00000013") + acksBy("studio/t15", "aaaa00000014"), 0);
});

test("with no window in front, the one used last takes it", async () => {
  host();
  world.window = { platform: "macos", active: false };
  world.terminals = [{ address: "studio/t9", labels: {} }];
  const { cx } = await watcher();
  labelsOf("studio/t9")[m.bidKey("aaaa00000006", "mac-b")] = String(Date.now() + 60_000);
  ask("studio/t9", "aaaa00000006", "https://example.com/");
  await cx.tick();
  assert.equal(acksBy("studio/t9", "aaaa00000006"), 0, "mac-b was used later");
  assert.deepEqual(cx.opened, []);

  // This window was in front a moment ago; the other one hasn't been used for a long time.
  world.window = { platform: "macos", active: true };
  await cx.tick();
  world.window = { platform: "macos", active: false };
  labelsOf("studio/t9")[m.bidKey("aaaa00000007", "mac-b")] = "0";
  ask("studio/t9", "aaaa00000007", "https://example.com/2");
  await cx.tick();
  assert.equal(acksBy("studio/t9", "aaaa00000007"), 1);
  assert.deepEqual(cx.opened, ["https://example.com/2"]);
});

test("remote-open labels left behind are swept after two minutes", async () => {
  host();
  world.window = { platform: "macos", active: false };
  world.terminals = [{ address: "studio/t16", labels: { [m.bidKey("dead00000001", "mac-z")]: "5", "remote-open.req": "{}", other: "kept" } }];
  const { w, cx } = await watcher();
  await cx.tick();
  assert.equal(Object.keys(labelsOf("studio/t16")).length, 3, "not yet");
  for (const k of _state.keys.keys()) _state.keys.set(k, Date.now() - m.STALE_MS - 1000);
  w.swept = 0;
  await cx.tick();
  assert.deepEqual(labelsOf("studio/t16"), { other: "kept" });
});

test("a file that could run something, or a web page, is left to its own machine", async () => {
  host({ idle: 0 });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t12", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t12", "aaaa00000009", "/home/sandbox/evil.command");
  ask("studio/t12", "aaaa0000000a", "/home/sandbox/report.html");
  await cx.tick();
  assert.equal(world.hcs.some((a) => a[0] === "label" && a[2]?.startsWith(m.BID)), false, "not even a bid: herdr-open falls back there");
  assert.equal(world.execs.some(([cmd, args]) => cmd === "/usr/bin/open" || (cmd === "/bin/sh" && args[1].includes("base64"))), false);
});

test("an image a program opened is copied over and shown in the floating viewer", async () => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  host({ idle: 0, wc: `      33 /home/sandbox/out/chart.png\n`, b64: bytes.toString("base64") });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t10", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t10", "aaaa00000008", "/home/sandbox/out/chart.png");
  await cx.tick();
  const win = world.overlays.at(-1);
  assert.equal(win.kind, "window");
  assert.equal(win.key, "remote-open-viewer");
  assert.deepEqual([win.width, win.height], [802, 638]);
  assert.equal(win.props.view, "image");
  assert.equal(win.props.machine, "studio");
  assert.match(win.props.file, /^data\/remote-open\/cache\/[0-9a-z]+-[0-9a-f]{8}-chart\.png$/);
  assert.deepEqual(Buffer.from(disk.get(win.props.local)), bytes);
  // base64 reads stdin: macOS's takes no file argument.
  const b64 = world.execs.find(([cmd, args]) => cmd === "/bin/sh" && args[1].includes("base64"));
  assert.deepEqual(b64, ["/bin/sh", ["-c", 'exec base64 <"$1"', "sh", "/home/sandbox/out/chart.png"], { on: "studio", timeout: 60_000 }]);
  const size = world.execs.find(([cmd, args]) => cmd === "/bin/sh" && args[1].includes("wc -c"));
  assert.deepEqual(size[1].slice(2), ["sh", "/home/sandbox/out/chart.png"]);
  assert.match(size[1][1], /\[ -f "\$1" \]/, "only a regular file");
  assert.ok(world.execs.some(([cmd, args]) => cmd === "/usr/bin/xattr" && args[1] === "com.apple.quarantine" && args[3] === win.props.local), "marked as from elsewhere");
});

test("an image too big to draw here opens in its Mac app instead", async () => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(30000, 16);
  bytes.writeUInt32BE(30000, 20);
  host({ idle: 0, wc: "33\n", b64: bytes.toString("base64") });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t17", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t17", "aaaa00000015", "/home/sandbox/huge.png");
  await cx.tick();
  assert.equal(world.overlays.length, 0);
  assert.ok(world.execs.some(([cmd, args]) => cmd === "/usr/bin/open" && /huge\.png$/.test(args[0])));
});

test("a markdown file a program opened is shown rendered in its own viewer", async () => {
  const md = "# Notes\n\nCaf\u00e9 \u2014 see [docs](https://example.com/docs).\n";
  const bytes = Buffer.from(md, "utf8");
  host({ idle: 0, wc: `${bytes.length}\n`, b64: bytes.toString("base64") });
  world.window = { platform: "macos", active: true };
  world.terminals = [{ address: "studio/t18", labels: {} }];
  const { cx } = await watcher();
  ask("studio/t18", "aaaa00000016", "/home/sandbox/notes.md");
  await cx.tick();
  const win = world.overlays.at(-1);
  assert.equal(win.kind, "window");
  assert.equal(win.key, "remote-open-markdown");
  assert.equal(win.props.view, "markdown");
  assert.equal(win.props.text, md);
  assert.equal(win.props.name, "notes.md");
  assert.ok(world.execs.some(([cmd, args]) => cmd === "/usr/bin/xattr" && args[3] === win.props.local), "marked as from elsewhere");
  assert.ok(!world.execs.some(([cmd]) => cmd === "/usr/bin/open"), "not handed to its Mac app");
});

test("the markdown viewer renders the text, copies it, opens web links only, and closes on Esc", () => {
  world.props = { view: "markdown", text: "# Notes\n[a](https://example.com/a) [b](other.md)", local: "/x/notes.md", name: "notes.md", machine: "studio", path: "/home/notes.md", overlay: "o4" };
  world.closed = [];
  const cx = makeCx();
  const v = new RemoteOpen();
  v.init(world.props, cx);
  const tree = v.render();
  const md = [...(function* walk(n) { yield n; for (const k of n.kids ?? []) if (k && typeof k === "object") yield* walk(k); })(tree)].find((n) => n.kind === "text_view");
  assert.equal(md.arg.text, world.props.text);
  assert.match(text(byId(tree, "ro-bar")), /notes\.md.*studio/);
  const acts = v.viewerActs();
  acts.copyText(cx);
  assert.equal(cx.clipboard, world.props.text);
  acts.link("https://example.com/a", cx);
  acts.link("other.md", cx);
  acts.link("#top", cx);
  assert.deepEqual(cx.opened, ["https://example.com/a"]);
  acts.key({ key: "f" }, cx);
  assert.equal(v.fit, true, "no fit toggle here");
  acts.key({ key: "escape" }, cx);
  assert.deepEqual(world.closed, ["o4"]);
});

test("the menu lists the images the terminal printed above Herdr's pane items", async () => {
  host();
  world.screen = "rendered out/chart.png\nall done";
  world.existing = "/home/sandbox/app/out/chart.png\n";
  world.panes = [{ pane: "p1" }];
  world.keys = [{ section: "global", action: "pane.split:right", keys: "⌘D" }];
  world.terminals = [{ address: "studio/t11", cwd: "/home/sandbox/app", labels: {} }];
  world.props = { tab: "pane", target: { pane: "p1", terminal: "studio/t11" }, overlay: "o9" };
  const cx = makeCx();
  const menu = new RemoteOpen();
  menu.init(world.props, cx);
  await cx.settle();
  const labels = menu.items().map((it) => it.label);
  assert.deepEqual(labels, ["Open chart.png", "All images…", "Split right", "Split down", "Zoom", "Send right-clicks to pane", "Close pane"]);
  assert.equal(menu.items()[1].hint, "1", "how many the screen shows");
  assert.equal(menu.items()[2].hint, "⌘D");
  const tree = menu.render();
  assert.match(text(byId(tree, "mi-0")), /Open chart\.png/);

  // With a watcher running, the menu hands the copy over and closes at once.
  const { cx: wcx } = await watcher();
  await wcx.tick();
  world.props = { tab: "pane", target: { pane: "p1", terminal: "studio/t11" }, overlay: "o9" };
  world.closed = [];
  menu.choose(0, cx);
  assert.deepEqual(world.closed, ["o9"]);
});

test("the viewer closes on Esc and switches between fit and actual size", () => {
  world.props = { view: "image", file: "data/remote-open/cache/x-1-a.png", local: "/x/a.png", name: "a.png", machine: "studio", path: "/home/a.png", w: 800, h: 600, overlay: "o3" };
  world.closed = [];
  const cx = makeCx();
  const v = new RemoteOpen();
  v.init(world.props, cx);
  const acts = v.viewerActs();
  acts.size({ width: 416, height: 316 }, cx);
  let tree = v.render();
  const pic = [...(function* walk(n) { yield n; for (const k of n.kids ?? []) if (k && typeof k === "object") yield* walk(k); })(tree)].find((n) => n.kind === "image");
  assert.deepEqual(pic.calls.filter(([k]) => k === "w" || k === "h"), [["w", 400], ["h", 300]]);
  acts.toggleFit(cx);
  tree = v.render();
  assert.match(text(byId(tree, "ro-bar")), /studio · 800×600/);
  acts.key({ key: "escape" }, cx);
  assert.deepEqual(world.closed, ["o3"]);
});

test("the menu keeps the newest four, and its gallery row opens the gallery window", async () => {
  host();
  const shots = ["a", "b", "c", "d", "e", "f"].map((n) => `/tmp/shots/${n}.png`);
  world.screen = shots.join("\n");
  world.present = new Set(shots);
  world.panes = [{ pane: "p1" }];
  world.terminals = [{ address: "t4", cwd: "/home/me", labels: {} }];
  world.props = { tab: "pane", target: { pane: "p1", terminal: "t4" }, overlay: "o2" };
  const cx = makeCx();
  const menu = new RemoteOpen();
  menu.init(world.props, cx);
  await cx.settle();
  const items = menu.items();
  assert.deepEqual(items.slice(0, 5).map((it) => it.label), ["Open f.png", "Open e.png", "Open d.png", "Open c.png", "All images…"]);
  assert.equal(items[4].hint, "6");
  assert.equal(items[5].sep, true, "a rule before Herdr's own items");
  menu.choose(4, cx);
  assert.deepEqual(world.closed, ["o2"]);
  const win = world.overlays.at(-1);
  assert.equal(win.kind, "window");
  assert.equal(win.key, "remote-open-gallery");
  assert.deepEqual(win.props, { view: "gallery", terminal: "t4", cwd: "/home/me" });
});

// A gallery window as the menu opens it, loaded.
async function gallery(address, cwd = "/home/me") {
  world.props = { view: "gallery", terminal: address, cwd, overlay: "o7" };
  const cx = makeCx();
  const g = new RemoteOpen();
  g.init(world.props, cx);
  await cx.settle();
  return { g, cx };
}

test("the gallery shows every image the terminal printed, history too, in the order printed", async () => {
  host();
  world.terminals = [{ address: "t4", cwd: "/home/me", title: "Flowie screenshots", labels: {} }];
  world.screen = "saved:\n- /tmp/shots/c.png\n- notes/plan.md\n- /tmp/shots/d.png and /tmp/gone.png";
  world.history = "- /tmp/shots/a.png\n- /tmp/shots/b.png\n" + world.screen;
  world.present = new Set(["/tmp/shots/a.png", "/tmp/shots/b.png", "/tmp/shots/c.png", "/tmp/shots/d.png", "/home/me/notes/plan.md"]);
  const { g } = await gallery("t4");
  assert.deepEqual(g.tiles.map((t) => t.name), ["a.png", "b.png", "c.png", "plan.md", "d.png"]);
  assert.deepEqual(g.tiles.map((t) => t.state), ["ready", "ready", "ready", "ready", "ready"]);
  const reads = world.hcs.filter((a) => a[0] === "read").map((a) => a[3]);
  assert.deepEqual(reads, ["0", String(m.HISTORY_LINES)], "the screen first, then history");
  // Every image gets a small picture from sips; markdown gets none.
  const sips = world.execs.filter(([cmd]) => cmd === "/usr/bin/sips");
  assert.equal(sips.length, 4);
  assert.deepEqual(sips[0][1].slice(0, 5), ["-Z", String(m.THUMB_PX), "-s", "format", "png"]);
  const tile = g.tiles[0];
  assert.match(tile.thumb, /^data\/remote-open\/cache\/[0-9a-z]+-[0-9a-f]{8}-a\.png\.thumb\.png$/);
  assert.deepEqual([tile.w, tile.h], [480, 300]);
  const tree = g.render();
  assert.match(text(byId(tree, "ro-bar")), /All images.*Flowie screenshots · 4 images, 1 markdown file/);
  assert.match(text(byId(tree, "gt-3")), /plan\.md/);
  const pic = [...(function* walk(n) { yield n; for (const k of n.kids ?? []) if (k && typeof k === "object") yield* walk(k); })(byId(tree, "gt-0"))].find((n) => n.kind === "image");
  assert.deepEqual(pic.calls.filter(([k]) => k === "w" || k === "h"), [["w", 184], ["h", 115]], "fitted into the tile");
});

test("a gallery tile opens its image in the viewer, which steps through the gallery's images", async () => {
  host();
  world.terminals = [{ address: "t4", cwd: "/home/me", labels: {} }];
  world.screen = "/tmp/shots/a.png\n/tmp/shots/b.png\n/tmp/notes.md\n/tmp/shots/c.png";
  world.present = new Set(["/tmp/shots/a.png", "/tmp/shots/b.png", "/tmp/notes.md", "/tmp/shots/c.png"]);
  const { g, cx } = await gallery("t4");
  world.exec = async (cmd, args) => {
    if (cmd === "/bin/sh" && args[1].includes("wc -c")) return { code: 0, stdout: "33\n", stderr: "" };
    if (cmd === "/bin/cp") disk.set(args.at(-1), png(800, 600));
    return { code: 0, stdout: "", stderr: "" };
  };
  g.openTile(1, cx);
  await cx.settle();
  let win = world.overlays.at(-1);
  assert.equal(win.key, "remote-open-viewer");
  assert.equal(win.props.name, "b.png");
  assert.deepEqual(win.props.set, { paths: ["/tmp/shots/a.png", "/tmp/shots/b.png", "/tmp/shots/c.png"], at: 1 }, "images only");

  // The viewer that opened: → opens c.png in its place, ← at the first one does nothing.
  world.props = { ...win.props, overlay: "o8" };
  const vcx = makeCx();
  const v = new RemoteOpen();
  v.init(world.props, vcx);
  assert.match(text(byId(v.render(), "ro-bar")), /this Mac · 800×600 · 2 of 3/);
  v.viewerActs().key({ key: "right" }, vcx);
  await vcx.settle();
  win = world.overlays.at(-1);
  assert.equal(win.props.name, "c.png");
  assert.equal(win.props.set.at, 2);
  const opened = world.overlays.length;
  world.props = { ...win.props, set: { ...win.props.set, at: 0 }, overlay: "o9" };
  const first = new RemoteOpen();
  first.init(world.props, vcx);
  first.viewerActs().step(-1, vcx);
  await vcx.settle();
  assert.equal(world.overlays.length, opened);

  // A markdown tile opens the markdown viewer.
  world.exec = async (cmd) => (cmd === "/bin/sh" ? { code: 0, stdout: "6\n", stderr: "" } : { code: 0, stdout: "", stderr: "" });
  disk.set("/tmp/notes.md", "# Hi\n");
  world.exec = async (cmd, args) => {
    if (cmd === "/bin/sh" && args[1].includes("wc -c")) return { code: 0, stdout: "5\n", stderr: "" };
    if (cmd === "/bin/cp") disk.set(args.at(-1), Buffer.from("# Hi\n"));
    return { code: 0, stdout: "", stderr: "" };
  };
  g.openTile(2, cx);
  await cx.settle();
  assert.equal(world.overlays.at(-1).key, "remote-open-markdown");
});

test("an empty gallery says so, and Esc closes it", async () => {
  host();
  world.terminals = [{ address: "t4", cwd: "/home/me", labels: {} }];
  world.screen = "nothing here";
  const { g, cx } = await gallery("t4");
  const tree = g.render();
  assert.match(text(byId(tree, "ro-gallery-body")), /hasn't printed the path of an image/);
  assert.match(text(byId(tree, "ro-bar")), /t4 · none/);
  g.galleryUi().act.key({ key: "escape" }, cx);
  assert.deepEqual(world.closed, ["o7"]);
});

test("a gallery tile of an image on another machine is copied over, shrunk, and the copy dropped", async () => {
  host({ wc: "33\n", b64: png(2400, 1500).toString("base64") });
  world.terminals = [{ address: "studio/t3", cwd: "/home/sandbox", labels: {} }];
  world.screen = "out/chart.png";
  world.present = new Set(["/home/sandbox/out/chart.png"]);
  const { g } = await gallery("studio/t3", "/home/sandbox");
  const t = g.tiles[0];
  assert.equal(t.state, "ready");
  const sips = world.execs.find(([cmd]) => cmd === "/usr/bin/sips");
  const full = sips[1][5];
  assert.match(full, /\/cache\/[0-9a-z]+-[0-9a-f]{8}-chart\.png$/);
  assert.equal(disk.has(full), false, "the full copy goes once the tile is made");
  assert.ok(world.execs.some(([cmd, args]) => cmd === "/usr/bin/xattr" && args[3] === sips[1].at(-1)), "the tile marked as from elsewhere");
});

test("the gallery key command opens the focused terminal's gallery, or the one it names", async () => {
  host();
  world.window = { platform: "macos", active: true };
  world.terminals = [
    { address: "t4", cwd: "/home/me", labels: {} },
    { address: "studio/t9", cwd: "/home/sandbox", foreground: { cwd: "/home/sandbox/app" }, labels: {} },
  ];
  const { cx } = await watcher();
  await cx.tick();
  world.focused = { terminal: "t4", shown: null };
  world.command("gallery");
  await cx.settle();
  assert.deepEqual(world.overlays.at(-1).props, { view: "gallery", terminal: "t4", cwd: "/home/me" });
  world.command("gallery:studio/t9");
  await cx.settle();
  assert.deepEqual(world.overlays.at(-1).props, { view: "gallery", terminal: "studio/t9", cwd: "/home/sandbox/app" });
  const opened = world.overlays.length;
  world.command("close"); // a viewer's
  await cx.settle();
  world.command("gallery:t77");
  await cx.settle();
  assert.equal(world.overlays.length, opened);
  assert.match(world.notes.at(-1).body, /no terminal t77/);
  world.focused = null;
});

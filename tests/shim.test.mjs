// remote/herdr-open and remote/setup.sh, run for real with a stand-in hc and a throwaway HOME.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync, chmodSync, rmSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const shim = join(root, "remote/herdr-open");
const setup = join(root, "remote/setup.sh");

// An hc that keeps labels in a JSON file. With ANSWER=1, a request is answered at once by a
// pretend Herdr window ("mac-a"), with a bid and an ack, the way the mod does.
const FAKE_HC = `#!/bin/sh
state=$FAKE_DIR/labels.json
[ -f "$state" ] || echo '{}' >"$state"
echo "$*" >>"$FAKE_DIR/calls"
case $1 in
  label) shift; t=$1; shift
    python3 - "$state" "$@" <<'PY'
import json, sys
path = sys.argv[1]; labels = json.load(open(path))
for kv in sys.argv[2:]:
    k, _, v = kv.partition("=")
    if v: labels[k] = v
    else: labels.pop(k, None)
    if k.startswith("remote-open.req.") and v and __import__("os").environ.get("ANSWER") == "1":
        labels["remote-open.ack." + k[len("remote-open.req."):]] = "mac-a"
        labels["remote-open.bid." + k[len("remote-open.req."):] + ".mac-a"] = "5"
json.dump(labels, open(path, "w"), separators=(",", ":"))
PY
    ;;
  get) printf '{"address":"t1","labels":%s}\\n' "$(cat "$state")" ;;
esac
`;

function sandbox() {
  // Its real path: the shell reports $PWD with /private on macOS.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-open-")));
  writeFileSync(join(dir, "hc"), FAKE_HC);
  chmodSync(join(dir, "hc"), 0o755);
  writeFileSync(join(dir, "opener"), `#!/bin/sh\necho "opened: $*" >>"$FAKE_DIR/opened"\n`);
  chmodSync(join(dir, "opener"), 0o755);
  return dir;
}

function run(dir, args, env = {}, cwd = dir) {
  return spawnSync("/bin/sh", [shim, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: dir, FAKE_DIR: dir, HERDR_OPEN_HC: join(dir, "hc"), HERDR_OPEN_OPENER: join(dir, "opener"), HERDR_OPEN_TRIES: "3", HC_TERMINAL_ID: "t1", ...env },
  });
}

const read = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
const requests = (dir) =>
  read(dir, "calls")
    .split("\n")
    .map((l) => l.match(/^label t1 remote-open\.req\.([0-9a-f]+)=(\{.*)$/))
    .filter(Boolean)
    .map(([, id, json]) => ({ key: id, ...JSON.parse(json) }));
const labels = (dir) => JSON.parse(read(dir, "labels.json") || "{}");

test("a page goes to the Herdr window that takes it; its request and bids are cleared after", () => {
  const dir = sandbox();
  // Another request on the same terminal, still waiting: it's left alone.
  writeFileSync(join(dir, "labels.json"), JSON.stringify({ "remote-open.req.0123456789abcdef": "{}", "remote-open.bid.0123456789abcdef.mac-b": "1" }));
  const r = run(dir, ["https://example.com/a?b=1&c=2"], { ANSWER: "1" });
  assert.equal(r.status, 0, r.stderr);
  const [req] = requests(dir);
  assert.equal(req.v, 1);
  assert.match(req.id, /^[0-9a-f]{16}$/);
  assert.equal(req.key, req.id);
  assert.equal(req.arg, "https://example.com/a?b=1&c=2");
  assert.equal(req.cwd, dir);
  assert.equal(read(dir, "opened"), "", "not opened here");
  // The ack stays for the Mac to read back; the mod takes it off.
  assert.deepEqual(labels(dir), {
    "remote-open.req.0123456789abcdef": "{}",
    "remote-open.bid.0123456789abcdef.mac-b": "1",
    [`remote-open.ack.${req.id}`]: "mac-a",
  });
  rmSync(dir, { recursive: true });
});

test("with no window taking it, it says so on the ack and the machine's own opener gets it", () => {
  const dir = sandbox();
  const r = run(dir, ["https://example.com/"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, "opened"), "opened: https://example.com/\n");
  const [req] = requests(dir);
  assert.ok(read(dir, "calls").includes(`label t1 remote-open.ack.${req.id}=-`), "gave up out loud");
  assert.deepEqual(labels(dir), {}, "everything was taken off again");
  rmSync(dir, { recursive: true });
});

test("stopped while it waits, it takes its labels off", async () => {
  const dir = sandbox();
  const { spawn } = await import("node:child_process");
  const child = spawn("/bin/sh", [shim, "https://example.com/"], {
    cwd: dir,
    env: { PATH: "/usr/bin:/bin", HOME: dir, FAKE_DIR: dir, HERDR_OPEN_HC: join(dir, "hc"), HERDR_OPEN_OPENER: join(dir, "opener"), HERDR_OPEN_TRIES: "50", HC_TERMINAL_ID: "t1" },
  });
  const gone = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
  for (let i = 0; i < 100 && !Object.keys(labels(dir)).length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(Object.keys(labels(dir)).length, 1, "the request went up");
  child.kill("SIGTERM");
  assert.equal((await gone).code, 130);
  assert.deepEqual(labels(dir), {});
  assert.equal(read(dir, "opened"), "", "and nothing opened");
  rmSync(dir, { recursive: true });
});

test("outside a Herdr terminal nothing is asked", () => {
  const dir = sandbox();
  const r = run(dir, ["https://example.com/"], { HC_TERMINAL_ID: "" });
  assert.equal(r.status, 0);
  assert.equal(read(dir, "calls"), "");
  assert.equal(read(dir, "opened"), "opened: https://example.com/\n");
  rmSync(dir, { recursive: true });
});

test("a relative file becomes absolute; a missing one, another scheme or two arguments stay here", () => {
  const dir = sandbox();
  mkdirSync(join(dir, "out"));
  writeFileSync(join(dir, "out", 'my "chart".png'), "x");
  assert.equal(run(dir, ['out/my "chart".png'], { ANSWER: "1" }).status, 0);
  assert.equal(requests(dir)[0].arg, join(dir, 'out/my "chart".png'), "quotes survive the JSON");
  for (const args of [["missing.png"], ["mailto:a@b.c"], ["-a"], ["one", "two"]]) {
    rmSync(join(dir, "opened"), { force: true });
    rmSync(join(dir, "calls"), { force: true });
    run(dir, args, { ANSWER: "1" });
    assert.equal(read(dir, "calls"), "", `${args} asked Herdr`);
    assert.equal(read(dir, "opened"), `opened: ${args.join(" ")}\n`);
  }
  rmSync(dir, { recursive: true });
});

test("as xdg-open on Linux it hands what it can't send to the next xdg-open, never to itself", () => {
  const dir = sandbox();
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "real"));
  execFileSync("/bin/cp", [shim, join(dir, "bin", "herdr-open")]);
  symlinkSync("herdr-open", join(dir, "bin", "xdg-open"));
  writeFileSync(join(dir, "real", "xdg-open"), `#!/bin/sh\necho "real: $*" >>"$FAKE_DIR/opened"\n`);
  chmodSync(join(dir, "real", "xdg-open"), 0o755);
  // A uname that says Linux, first on PATH, so this runs the Linux fallback on a Mac too.
  mkdirSync(join(dir, "linux"));
  writeFileSync(join(dir, "linux", "uname"), "#!/bin/sh\necho Linux\n");
  chmodSync(join(dir, "linux", "uname"), 0o755);
  const env = { PATH: `${join(dir, "linux")}:${join(dir, "bin")}:${join(dir, "real")}:/usr/bin:/bin`, HOME: dir, FAKE_DIR: dir, HC_TERMINAL_ID: "", HERDR_OPEN_OPENER: "" };
  const r = spawnSync(join(dir, "bin", "xdg-open"), ["mailto:x@y.z"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, "opened"), "real: mailto:x@y.z\n");
  // Called through a link from elsewhere (~/.local/bin/herdr-open), it still knows its folder.
  mkdirSync(join(dir, "localbin"));
  symlinkSync(join(dir, "bin", "herdr-open"), join(dir, "localbin", "herdr-open"));
  rmSync(join(dir, "opened"));
  const linked = spawnSync(join(dir, "localbin", "herdr-open"), ["mailto:a@b.c"], { env: { ...env, PATH: `${join(dir, "linux")}:${join(dir, "localbin")}:${env.PATH.split(":").slice(1).join(":")}` }, encoding: "utf8", timeout: 5000 });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(read(dir, "opened"), "real: mailto:a@b.c\n", "the real xdg-open, not its own");
  // With no other xdg-open it says so instead of calling itself forever.
  rmSync(join(dir, "real"), { recursive: true });
  const none = spawnSync(join(dir, "bin", "xdg-open"), ["https://example.com/"], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(none.status, 3);
  assert.match(none.stderr, /Open it yourself:\n {2}https:\/\/example\.com\//);
  rmSync(dir, { recursive: true });
});

// ---------------------------------------------------------------------------
// setup.sh

function setupRun(home, shell, action) {
  return spawnSync("/bin/sh", [setup, action], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, SHELL: shell } });
}

function machineHome() {
  const home = mkdtempSync(join(tmpdir(), "herdr-open-home-"));
  mkdirSync(join(home, ".local/share/herdr-open/bin"), { recursive: true });
  mkdirSync(join(home, ".local/bin"));
  execFileSync("/bin/cp", [shim, join(home, ".local/share/herdr-open/bin/herdr-open")]);
  return home;
}

const BEGIN = "# >>> herdr-open (herdr-remote-open) >>>";

test("bash: the block goes into ~/.profile once, and comes out again", () => {
  const home = machineHome();
  writeFileSync(join(home, ".profile"), "export EDITOR=vi\n");
  for (let i = 0; i < 2; i++) assert.equal(setupRun(home, "/bin/bash", "install").status, 0);
  const text = readFileSync(join(home, ".profile"), "utf8");
  assert.equal(text.split(BEGIN).length - 1, 1, "once");
  assert.ok(text.startsWith("export EDITOR=vi\n"));
  // It sets BROWSER only in Herdr terminals.
  const browser = (env) => execFileSync("/bin/sh", ["-c", `. "$HOME/.profile"; printf %s "\${BROWSER:-}"`], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, ...env } });
  assert.equal(browser({ HC_TERMINAL_ID: "t1" }), join(home, ".local/share/herdr-open/bin/herdr-open"));
  assert.equal(browser({}), "");
  assert.match(setupRun(home, "/bin/bash", "status").stdout, /BROWSER: set in .*\.profile/);
  assert.equal(readlinkSync(join(home, ".local/bin/herdr-open")), join(home, ".local/share/herdr-open/bin/herdr-open"), "linked where ~/.local/bin is");
  assert.equal(setupRun(home, "/bin/bash", "remove").status, 0);
  assert.equal(existsSync(join(home, ".local/bin/herdr-open")), false);
  assert.equal(readFileSync(join(home, ".profile"), "utf8"), "export EDITOR=vi\n");
  assert.equal(existsSync(join(home, ".local/share/herdr-open")), false);
  rmSync(home, { recursive: true });
});

test("a file whose markers don't pair up is left alone; an edited one is backed up first", () => {
  const home = machineHome();
  const broken = `a=1\n${BEGIN}\nx\n# <<< herdr-open <<< (edited)\nb=2\n`;
  writeFileSync(join(home, ".profile"), broken);
  const r = setupRun(home, "/bin/bash", "install");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /without its pair/);
  assert.equal(readFileSync(join(home, ".profile"), "utf8"), broken, "not a line lost");

  writeFileSync(join(home, ".profile"), "export EDITOR=vi\n");
  assert.equal(setupRun(home, "/bin/bash", "install").status, 0);
  assert.equal(readFileSync(join(home, ".profile.before-herdr-open"), "utf8"), "export EDITOR=vi\n");
  rmSync(home, { recursive: true });
});

test("zsh: a ~/.zshenv that reads local.zshenv gets the block there; a linked one is left alone", () => {
  const home = machineHome();
  const dots = join(home, "dotfiles");
  mkdirSync(dots);
  writeFileSync(join(dots, ".zshenv"), '[[ -r "$HOME/.config/zsh/local.zshenv" ]] && source "$HOME/.config/zsh/local.zshenv"\n');
  symlinkSync(join(dots, ".zshenv"), join(home, ".zshenv"));
  assert.equal(setupRun(home, "/bin/zsh", "install").status, 0);
  assert.ok(readFileSync(join(home, ".config/zsh/local.zshenv"), "utf8").includes(BEGIN));
  assert.ok(!readFileSync(join(dots, ".zshenv"), "utf8").includes(BEGIN), "the dotfiles copy is untouched");

  const other = machineHome();
  writeFileSync(join(dots, ".zshenv2"), "export A=1\n");
  symlinkSync(join(dots, ".zshenv2"), join(other, ".zshenv"));
  const r = setupRun(other, "/bin/zsh", "install");
  assert.match(r.stdout, /is a link .* left alone/);
  assert.equal(readFileSync(join(dots, ".zshenv2"), "utf8"), "export A=1\n");
  rmSync(home, { recursive: true });
  rmSync(other, { recursive: true });
});

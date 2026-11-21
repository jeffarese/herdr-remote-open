// What remote-open does on this computer: ssh forwards, copying files from other machines,
// opening pages and images. Everything here goes through Herdr's `exec`/`hc` or the runtime's
// fs and net, with values passed as separate arguments, never inside a shell string.

import { exec, hc, appHome, home, notify, openOverlay } from "herdr";
import * as fs from "fs/promises";
import net from "net";
import * as m from "./model.js";

export const MOD = "remote-open";
export const VIEWER_KEY = "remote-open-viewer";
export const MARKDOWN_KEY = "remote-open-markdown";
export const BAR = 36;

const dataDir = () => `${appHome()}/data/${MOD}`;
const cacheDir = () => `${dataDir()}/cache`;
const sockDir = () => `${dataDir()}/cm`;
const recordsFile = () => `${dataDir()}/forwards.json`;

export const message = (e) => (e && typeof e.message === "string" ? e.message : String(e));

// ---------------------------------------------------------------------------
// Machines

let machines = { at: 0, list: [] };

// The ssh destination Herdr itself uses for a machine (`hc machine ls`), or null for one it
// reaches some other way (`--via`).
export async function sshTarget(machine) {
  if (!machine) return null;
  if (Date.now() - machines.at > 60_000 || !machines.list.some((x) => x.name === machine)) {
    const r = await hc(["machine", "ls", "--json"]).catch(() => null);
    try {
      if (r?.code === 0) machines = { at: Date.now(), list: JSON.parse(r.stdout).machines ?? [] };
    } catch {
      // keep what we had
    }
  }
  const found = machines.list.find((x) => x.name === machine);
  const target = found && !found.via ? found.target : null;
  return typeof target === "string" && target && !target.startsWith("-") && !m.hasControl(target) && !/\s/.test(target) ? target : null;
}

// This Mac's name in labels: its host name and a tag made once per install, since two Macs can
// share a host name.
export async function myName() {
  const r = await exec("/bin/hostname", ["-s"], { timeout: 3000 }).catch(() => null);
  const file = `${dataDir()}/id`;
  let tag = "";
  try {
    tag = (await fs.readFile(file, "utf8")).trim();
  } catch {
    tag = "";
  }
  if (!/^[0-9a-f]{6}$/.test(tag)) {
    tag = Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");
    await fs.mkdir(dataDir(), { recursive: true }).catch(() => {});
    await fs.writeFile(file, `${tag}\n`).catch(() => {});
  }
  return m.appName(r?.stdout, tag);
}

// A terminal's labels as its machine has them now; terminals() can be a moment behind. Null
// when the machine doesn't answer.
export async function labelsNow(address) {
  const r = await hc(["get", address, "--json"]).catch(() => null);
  if (r?.code !== 0) return null;
  try {
    const labels = JSON.parse(r.stdout)?.labels;
    return labels && typeof labels === "object" ? labels : {};
  } catch {
    return null;
  }
}

// Sets ("k=v") or removes ("k=") labels on a terminal. True when hc did it.
export async function setLabels(address, pairs) {
  if (!pairs.length) return true;
  const r = await hc(["label", address, ...pairs]).catch(() => null);
  return r?.code === 0;
}

// How long ago someone last touched this Mac's keyboard, mouse or trackpad, in ms.
export async function idleMs() {
  const r = await exec("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-r", "-d", "1", "-k", "HIDIdleTime"], { timeout: 3000 }).catch(() => null);
  const ns = Number(r?.stdout?.match(/"HIDIdleTime"\s*=\s*(\d+)/)?.[1]);
  return Number.isFinite(ns) ? Math.floor(ns / 1e6) : 0;
}

// Whether something on this Mac accepts connections on a loopback port.
export async function listening(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    try {
      const s = await net.connect(host, port);
      s.close();
      return true;
    } catch {
      // nothing there
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Forwards: `ssh -L` processes this mod started, each with its own control socket, so it can
// check one and end exactly that one. Shared by every copy of the mod. A record is written
// (`pending`) before its ssh starts, so a copy closing halfway can't leave one nobody lists.

const fw = { list: [], load: null, version: 0, busy: new Map() };
const PENDING_MS = 40_000;

export const forwards = () => fw.list.filter((r) => !r.until || r.until > Date.now());
export const forwardsVersion = () => fw.version;

const validRecord = (r) =>
  r && Number.isInteger(r.port) && r.port > 0 && r.port < 65536 && typeof r.machine === "string" && typeof r.target === "string" && typeof r.sock === "string" && typeof r.host === "string";

async function save() {
  fw.version++;
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(recordsFile(), `${JSON.stringify(fw.list, null, 1)}\n`);
  } catch {
    // the list in memory still works
  }
}

async function alive(r) {
  if (r.until && r.until <= Date.now()) return false;
  const res = await exec("/usr/bin/ssh", ["-S", r.sock, "-O", "check", "--", r.target], { timeout: 5000 }).catch(() => null);
  return res?.code === 0;
}

// Ends the ssh behind a socket, whatever state it's in. The host is only there for ssh's syntax.
async function end(sock, target = "herdr") {
  await exec("/usr/bin/ssh", ["-S", sock, "-O", "exit", "--", target], { timeout: 5000 }).catch(() => null);
  await fs.unlink(sock).catch(() => {});
}

// Forwards that outlived a reload or a restart of Herdr are picked up again; dead ones are ended
// and dropped, and so is any socket with no record. Every copy shares one load, but a copy that
// closes mid-load leaves its calls unsettled, so a load not done in 20 s is started again.
export function loadForwards() {
  if (fw.load && (fw.load.done || Date.now() - fw.load.at < 20_000)) return fw.load.p;
  const run = { at: Date.now(), done: false, p: null };
  run.p = (async () => {
    let saved = [];
    try {
      saved = JSON.parse(await fs.readFile(recordsFile(), "utf8"));
    } catch {
      saved = [];
    }
    const kept = [];
    for (const r of Array.isArray(saved) ? saved : []) {
      if (!validRecord(r)) continue;
      if (r.pending && Date.now() - r.started < PENDING_MS) kept.push(r); // still starting
      else if (await alive(r)) kept.push({ ...r, pending: false });
      else await end(r.sock, r.target);
    }
    const ports = new Set([...kept.map((r) => r.port), ...fw.busy.keys(), ...fw.list.map((r) => r.port)]);
    for (const name of await fs.readdir(sockDir()).catch(() => [])) {
      const port = Number(name.match(/^(\d+)\.sock$/)?.[1]);
      if (port && !ports.has(port)) await end(`${sockDir()}/${name}`);
    }
    // Forwards started while this ran stay.
    fw.list = [...kept.filter((r) => !fw.list.some((x) => x.port === r.port)), ...fw.list];
    await save();
  })()
    .catch(() => {})
    .finally(() => {
      run.done = true;
    });
  fw.load = run;
  return run.p;
}

// Drops sign-in forwards whose time is up (their ssh ends by itself). True when one went.
export function expire() {
  const now = Date.now();
  const kept = fw.list.filter((r) => !r.until || r.until > now);
  if (kept.length === fw.list.length) return false;
  fw.list = kept;
  save();
  return true;
}

// Settles records left `pending` by a copy that closed while its ssh started.
export async function tidy() {
  for (const r of fw.list.filter((x) => x.pending && Date.now() - x.started >= PENDING_MS && !fw.busy.has(x.port))) {
    if (await alive(r)) fw.list = fw.list.map((x) => (x === r ? { ...r, pending: false } : x));
    else {
      await end(r.sock, r.target);
      fw.list = fw.list.filter((x) => x !== r);
    }
    await save();
  }
}

export async function stopForward(r) {
  await end(r.sock, r.target);
  fw.list = fw.list.filter((x) => x.port !== r.port);
  await save();
}

export async function stopAll() {
  for (const r of [...fw.list]) await stopForward(r);
}

// Port `port` on this Mac, forwarded to `host:port` on `machine`. A sign-in's forward ends by
// itself after AUTH_SECONDS; a page's stays until it's stopped. The local port is the remote one,
// since that is the port the link and the sign-in's redirect name. One at a time per port: a
// second request waits for the first (`sleep` is the copy's cx.sleep).
export async function ensureForward(want, sleep) {
  const { port } = want;
  while (fw.busy.has(port) && Date.now() - fw.busy.get(port) < PENDING_MS) await sleep(250);
  fw.busy.set(port, Date.now());
  try {
    return await forward(want, sleep);
  } finally {
    fw.busy.delete(port);
  }
}

async function forward({ machine, target, port, host, auth }, sleep) {
  let cur = fw.list.find((r) => r.port === port);
  if (cur && !(await alive(cur))) {
    await end(cur.sock, cur.target);
    fw.list = fw.list.filter((r) => r !== cur);
    cur = null;
  }
  if (cur) {
    if (cur.machine !== machine) return { error: `Port ${port} on this Mac already forwards to ${cur.machine}. Stop that forward first.` };
    // A page's forward serves a sign-in on the same port as well; a new sign-in gets a fresh timer.
    if (!cur.until) return { record: cur, reused: true };
    await stopForward(cur);
    for (let i = 0; i < 6 && (await listening(port)); i++) await sleep(250); // ssh lets go of it
  }
  if (await listening(port)) return { error: `Port ${port} is already in use on this Mac, so the link would reach that instead.` };

  await fs.mkdir(sockDir(), { recursive: true });
  const sock = `${sockDir()}/${port}.sock`;
  // macOS caps a socket path near 104 bytes, and ssh adds a temporary suffix while it binds.
  if (sock.length > 84) return { error: `The folder for ssh's control socket is too deep: ${sockDir()}` };
  await end(sock, target); // a socket left from before
  const errFile = `${sockDir()}/${port}.err`;
  const remote = host.includes(":") ? `[${host}]` : host;
  const binds = [`127.0.0.1:${port}:${remote}:${port}`, ...(host === "::1" ? [`[::1]:${port}:${remote}:${port}`] : [])];
  const args = [
    "-f", "-T", "-M", "-S", sock,
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ControlPersist=no",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=30",
    ...binds.flatMap((b) => ["-L", b]),
    ...(auth ? [] : ["-N"]),
    "--", target,
    ...(auth ? ["sleep", String(m.AUTH_SECONDS)] : []),
  ];
  const now = Date.now();
  const record = { port, machine, target, host, sock, started: now, until: auth ? now + m.AUTH_SECONDS * 1000 : null, pending: true };
  fw.list = [...fw.list.filter((x) => x.port !== port), record];
  await save();
  // ssh -f keeps its output open in the background: give it /dev/null and a file, so the
  // command comes back as soon as the forward is up.
  const script = 'e=$1; shift; exec /usr/bin/ssh "$@" </dev/null >/dev/null 2>"$e"';
  const r = await exec("/bin/sh", ["-c", script, "sh", errFile, ...args], { timeout: 30_000 }).catch((e) => ({ code: -1, stderr: message(e) }));
  if (r.code !== 0) {
    fw.list = fw.list.filter((x) => x !== record);
    await save();
    let why = "";
    try {
      why = (await fs.readFile(errFile, "utf8")).trim().split("\n").filter(Boolean).pop() ?? "";
    } catch {
      why = r.stderr?.trim() ?? "";
    }
    return { error: `Couldn't forward port ${port} from ${machine}${why ? `: ${why}` : "."}` };
  }
  const up = { ...record, pending: false };
  fw.list = fw.list.map((x) => (x === record ? up : x));
  await save();
  return { record: up };
}

// ---------------------------------------------------------------------------
// Files

// Prints a file's size when it is a regular file this user can read: never a device or a folder.
const SIZE = '[ -f "$1" ] && [ -r "$1" ] || exit 3; exec wc -c <"$1"';
// From stdin: macOS's base64 takes no file argument (it wants -i), GNU and busybox take either.
const BASE64 = 'exec base64 <"$1"';

// Marks a copy the way a browser marks a download, so macOS treats it as coming from elsewhere.
async function quarantine(local) {
  const flag = `0081;${Math.floor(Date.now() / 1000).toString(16)};Herdr;`;
  await exec("/usr/bin/xattr", ["-w", "com.apple.quarantine", flag, local], { timeout: 5000 }).catch(() => null);
}

// Copies a file into the cache under the app's folder, where Herdr can draw it. Returns its
// path there (absolute, and relative to the app's folder) and its bytes.
export async function fetchFile(machine, path, target) {
  const base = m.baseName(path);
  const where = machine ? { on: machine } : {};
  const st = await exec("/bin/sh", ["-c", SIZE, "sh", path], { ...where, timeout: 15_000 }).catch(() => null);
  const size = st?.code === 0 ? m.parseSize(st.stdout) : null;
  if (size === null) throw new Error(`${base} isn't a file${machine ? ` on ${machine}` : ""} any more.`);
  if (size > m.MAX_FILE) throw new Error(`${base} is ${Math.round(size / 1048576)} MB, more than remote-open copies.`);
  await fs.mkdir(cacheDir(), { recursive: true });
  const name = m.cacheName(machine, path, Date.now());
  const local = `${cacheDir()}/${name}`;
  const rel = `data/${MOD}/cache/${name}`;
  const failed = (e) => ({ code: -1, stderr: message(e) });
  let bytes;
  if (machine && size <= m.INLINE_MAX) {
    const r = await exec("/bin/sh", ["-c", BASE64, "sh", path], { on: machine, timeout: 60_000 }).catch(failed);
    if (r.code !== 0) throw new Error(`Couldn't copy ${base} from ${machine}.`);
    bytes = m.decodeBase64(r.stdout);
    if (bytes.length !== size) throw new Error(`${base} changed while it was copied from ${machine}. Try again.`);
    await fs.writeFile(local, bytes);
  } else {
    if (machine && !target) throw new Error(`${base} is over ${m.INLINE_MAX / 1048576} MB, and ${machine} has no ssh address to copy it with.`);
    // cp, not fs, for a file here: the runtime's fs only reaches some folders.
    const r = machine
      ? await exec("/usr/bin/scp", ["-q", "-o", "BatchMode=yes", "--", `${target}:${path}`, local], { timeout: 300_000 }).catch(failed)
      : await exec("/bin/cp", ["--", path, local], { timeout: 60_000 }).catch(failed);
    if (r.code !== 0) throw new Error(`Couldn't copy ${base}${machine ? ` from ${machine}` : ""}.`);
    bytes = await fs.readFile(local);
  }
  // What was copied, not what was measured: the file can have grown in between.
  if (bytes.length > m.MAX_FILE) {
    await fs.unlink(local).catch(() => {});
    throw new Error(`${base} is more than remote-open copies.`);
  }
  await quarantine(local);
  return { local, rel, bytes };
}

// Copies older than `days` go.
export async function sweepCache(days = 3) {
  const cutoff = Date.now() - days * 86_400_000;
  const names = await fs.readdir(cacheDir()).catch(() => []);
  for (const name of names) if (m.cacheTime(name) < cutoff) await fs.unlink(`${cacheDir()}/${name}`).catch(() => {});
}

// An image or a markdown file opens in Herdr's floating viewer; a PDF or text file in its Mac
// app. Nothing else is copied here.
// `extra` goes into the image viewer's props: the gallery passes `set` ({paths, at}), the images
// the viewer steps through with the arrow keys.
export async function openFile(machine, path, extra = {}) {
  if (!m.opensHere(path)) throw new Error(`remote-open only opens images, markdown, PDFs and text files, not ${m.baseName(path)}.`);
  const target = machine ? await sshTarget(machine) : null;
  if (m.isMarkdown(path)) {
    const got = await fetchFile(machine, path, target);
    if (got.bytes.length > m.MARKDOWN_MAX) {
      if (!(await openInApp(got.local))) throw new Error(`macOS couldn't open ${m.baseName(path)}.`);
      return;
    }
    openOverlay({
      mod: MOD,
      kind: "window",
      key: MARKDOWN_KEY,
      width: 760,
      height: 680,
      props: { view: "markdown", text: m.decodeUtf8(got.bytes), local: got.local, name: m.baseName(path), machine, path },
    });
    return;
  }
  if (m.isImage(path)) {
    const got = await fetchFile(machine, path, target);
    const size = m.imageSize(got.bytes);
    if (size && (size.w > 16384 || size.h > 16384 || size.w * size.h > 64e6)) {
      // Too big to decode in a Herdr window; its Mac app copes.
      if (!(await openInApp(got.local))) throw new Error(`macOS couldn't open ${m.baseName(path)}.`);
      return;
    }
    const { width, height } = m.viewerSize(size, BAR);
    openOverlay({
      mod: MOD,
      kind: "window",
      key: VIEWER_KEY,
      width,
      height,
      props: { ...extra, view: "image", file: got.rel, local: got.local, name: m.baseName(path), machine, path, w: size?.w ?? null, h: size?.h ?? null },
    });
    return;
  }
  const local = machine ? (await fetchFile(machine, path, target)).local : path;
  const r = await exec("/usr/bin/open", [local]).catch((e) => ({ code: -1, stderr: message(e) }));
  if (r.code !== 0) throw new Error(`macOS couldn't open ${m.baseName(path)}.`);
}

// A page opens in the browser here. One on the other machine's localhost, or a sign-in whose
// redirect goes back there, gets its port forwarded first.
export async function openWeb(machine, url, cx) {
  const lb = machine ? m.loopbackTarget(url) : null;
  if (!lb) {
    cx.open_url(url);
    return;
  }
  const target = await sshTarget(machine);
  if (!target) {
    notify({ title: "Couldn't forward the link", body: `${machine} has no ssh address in Herdr, so port ${lb.port} can't come to this Mac. Opened it anyway.`, level: "error" });
    cx.open_url(url);
    return;
  }
  const r = await ensureForward({ machine, target, port: lb.port, host: lb.host, auth: lb.auth }, (ms) => cx.sleep(ms));
  if (r.error) {
    notify({ title: "Couldn't open the link", body: r.error, level: "error" });
    return;
  }
  cx.open_url(url);
  notify(
    lb.auth
      ? { title: "Sign-in opened here", body: `Port ${lb.port} on ${machine} comes to this Mac for ${m.AUTH_SECONDS / 60} minutes, so the sign-in can finish there.`, level: "info", timeout: 6000 }
      : { title: `Opened :${lb.port} from ${machine}`, body: r.reused ? "Using the forward that was already up." : "The port stays forwarded until you stop it.", level: "info", timeout: 5000 },
  );
}

// ---------------------------------------------------------------------------
// The viewer's buttons

const COPY_IMAGE = `ObjC.import("AppKit");
function run(argv) {
  const img = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (!img || img.isNil()) return "no";
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  return pb.writeObjects($([img])) ? "ok" : "no";
}`;

export async function copyImage(local) {
  const r = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", COPY_IMAGE, local], { timeout: 10_000 }).catch(() => null);
  return r?.code === 0 && r.stdout.trim() === "ok";
}

// Into ~/Downloads under the file's own name, or "name (2).png" when that's taken. Never replaces a file.
// Through test and cp, since the runtime's fs doesn't reach ~/Downloads.
export async function saveToDownloads(local, name) {
  const dir = `${home()}/Downloads`;
  const taken = async (n) => (await exec("/bin/test", ["-e", `${dir}/${n}`]).catch(() => ({ code: 0 }))).code === 0;
  const free = await m.freeName(name.replace(/[/\u0000-\u001f]/g, "_"), taken);
  if (!free) throw new Error("No free name in Downloads.");
  const r = await exec("/bin/cp", ["-n", "--", local, `${dir}/${free}`]).catch((e) => ({ code: -1, stderr: message(e) }));
  if (r.code !== 0) throw new Error("Couldn't save it to Downloads.");
  return free;
}

export async function openInApp(local) {
  const r = await exec("/usr/bin/open", [local]).catch(() => null);
  return r?.code === 0;
}

// ---------------------------------------------------------------------------
// Image and markdown paths on a terminal's screen, for its right-click menu: the newest that are files on
// its machine, at most `max`. Only the screen: the terminal right-clicked is the one shown, and
// for a shown terminal `hc read --lines N` takes 1 to 4 s to add its history (and often gives
// up and returns the screen alone), where the screen comes back in about 10 ms.

const EXISTING = 'cwd=$1; shift; for f do case $f in "~/"*) f=$HOME/${f#"~/"} ;; /*) ;; *) f=$cwd/$f ;; esac; [ -f "$f" ] && printf "%s\\n" "$f"; done; exit 0';

// The gallery reads `lines` of history as well, once it has shown what's on the screen.
export async function terminalFiles(address, cwd, max = 5, lines = 0) {
  const { machine } = m.splitAddress(address);
  const r = await hc(["read", address, "--lines", String(lines)]).catch(() => null);
  if (!r || r.code !== 0) return [];
  // Twice as many as kept: a path with spaces is offered whole and as its tail.
  const found = m.filePaths(r.stdout, Math.max(16, max * 2));
  if (!found.length) return [];
  const e = await exec("/bin/sh", ["-c", EXISTING, "sh", cwd || "/", ...found], machine ? { on: machine, timeout: 10_000 } : { timeout: 10_000 }).catch(() => null);
  if (!e || e.code !== 0) return [];
  const out = [];
  for (const line of e.stdout.split("\n")) {
    if (!line.startsWith("/")) continue;
    const p = m.normalize(line);
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The gallery

export const GALLERY_KEY = "remote-open-gallery";

// A window of tiles for every image and markdown file the terminal printed (main.js fills it).
export function openGallery(address, cwd) {
  openOverlay({ mod: MOD, kind: "window", key: GALLERY_KEY, width: 884, height: 620, props: { view: "gallery", terminal: address, cwd: cwd ?? null } });
}

// A tile's picture: a PNG no bigger than THUMB_PX a side, made by sips into the cache, so the
// window never decodes twenty full-size screenshots. An SVG is drawn as it is. From another
// machine the image is copied over first, and that full copy goes again once the tile is made.
// Returns the picture's path relative to the app's folder and its size.
export async function thumbnail(machine, path) {
  const base = m.baseName(path);
  const full = machine ? await fetchFile(machine, path, await sshTarget(machine)) : null;
  const svg = /\.svg$/i.test(path);
  if (full && svg) return { rel: full.rel, size: m.imageSize(full.bytes) };
  try {
    await fs.mkdir(cacheDir(), { recursive: true });
    const name = svg ? m.cacheName(machine, path, Date.now()) : m.thumbName(machine, path, Date.now());
    const local = `${cacheDir()}/${name}`;
    // The paths are absolute (terminalFiles keeps only those), so none reads as an option.
    const r = svg
      ? await exec("/bin/cp", ["--", path, local], { timeout: 30_000 }).catch((e) => ({ code: -1, stderr: message(e) }))
      : await exec("/usr/bin/sips", ["-Z", String(m.THUMB_PX), "-s", "format", "png", full?.local ?? path, "--out", local], { timeout: 30_000 }).catch((e) => ({ code: -1, stderr: message(e) }));
    if (r.code !== 0) throw new Error(`Couldn't make a preview of ${base}.`);
    if (full) await quarantine(local);
    return { rel: `data/${MOD}/cache/${name}`, size: m.imageSize(await fs.readFile(local)) };
  } finally {
    if (full) await fs.unlink(full.local).catch(() => {});
  }
}

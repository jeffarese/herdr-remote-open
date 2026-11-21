// What remote-open decides, kept apart from Herdr so it can be tested on its own: what a request
// asks for, which port a link needs forwarded, which Herdr window takes a request, and what an
// image file is.

// Label keys on the terminal that asked, one set per request, so two at once don't touch:
//   remote-open.req.<id>        {"v":1,"id","t","arg","cwd"}, put there by herdr-open
//   remote-open.bid.<id>.<mac>  when someone last used Herdr on that Mac (ms)
//   remote-open.ack.<id>        the Mac that takes it
// herdr-open takes its req and the bids off when it's done; the ack goes after STALE_MS.
export const PREFIX = "remote-open.";
export const REQ = "remote-open.req.";
export const ACK = "remote-open.ack.";
export const BID = "remote-open.bid.";
export const reqKey = (id) => `${REQ}${id}`;
export const ackKey = (id) => `${ACK}${id}`;
export const bidKey = (id, app) => `${BID}${id}.${app}`;

// herdr-open waits 3 s for an ack. A Mac acks only this soon after it first saw the request,
// so a slow one can't take it after herdr-open gave up and opened it over there.
export const TAKE_WITHIN = 1800;
// Any remote-open label still there after this was left behind (a killed herdr-open).
export const STALE_MS = 120_000;

// The biggest file copied through `exec … base64` (its output is capped at 8 MiB, and base64
// adds a third plus line breaks); bigger ones go over scp, up to MAX_FILE.
export const INLINE_MAX = 5 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;

// How long a sign-in's callback port stays forwarded, in seconds.
export const AUTH_SECONDS = 600;

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTS.join("|")})$`, "i");

export const isImage = (path) => IMAGE_RE.test(path ?? "");

// Other files that open in their Mac app. Only kinds that can't run anything: no apps, scripts
// or .command files, and no web pages either (their scripts would run from a local file).
export const DOC_EXTS = ["pdf", "txt", "md", "csv", "json", "log"];
const DOC_RE = new RegExp(`\\.(${DOC_EXTS.join("|")})$`, "i");
export const isDocument = (path) => DOC_RE.test(path ?? "");
export const opensHere = (path) => isImage(path) || isDocument(path);

// The request the shim puts on its terminal: {"v":1,"id","t","arg","cwd"}.
export function parseRequest(value) {
  if (typeof value !== "string" || value.length > 16384) return null;
  let r;
  try {
    r = JSON.parse(value);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  if (typeof r.id !== "string" || !/^[0-9a-f]{6,32}$/.test(r.id)) return null;
  if (typeof r.arg !== "string" || r.arg === "" || hasControl(r.arg)) return null;
  const cwd = typeof r.cwd === "string" && r.cwd.startsWith("/") && !hasControl(r.cwd) ? r.cwd : null;
  return { id: r.id, t: Number.isFinite(r.t) ? r.t : 0, arg: r.arg, cwd };
}

export const hasControl = (s) => /[\u0000-\u001f\u007f]/.test(s);

// The valid requests on one terminal's labels, each under its own id.
export function requestsIn(labels) {
  const out = [];
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (!key.startsWith(REQ)) continue;
    const req = parseRequest(value);
    if (req && req.id === key.slice(REQ.length)) out.push(req);
  }
  return out;
}

// "studio/t5" → { machine: "studio", id: "t5" }; a bare "t5" is this computer's.
export function splitAddress(address) {
  const i = (address ?? "").lastIndexOf("/");
  return i < 0 ? { machine: null, id: address } : { machine: address.slice(0, i), id: address.slice(i + 1) };
}

// Collapses "." and ".." in an absolute path.
export function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

// What a request's argument is: a web page, or a file on the terminal's machine.
export function classify(arg, cwd) {
  if (/^https?:\/\//i.test(arg)) {
    let url;
    try {
      url = new URL(arg);
    } catch {
      return null;
    }
    return url.hostname ? { kind: "web", url: url.href } : null;
  }
  if (/^file:\/\//i.test(arg)) {
    let url;
    try {
      url = new URL(arg);
    } catch {
      return null;
    }
    if (url.hostname && url.hostname !== "localhost") return null;
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    return path.startsWith("/") && !hasControl(path) ? { kind: "file", path: normalize(path) } : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(arg)) return null; // mailto:, vscode:, … stay with the machine's opener
  if (arg.startsWith("/")) return { kind: "file", path: normalize(arg) };
  if (cwd) return { kind: "file", path: normalize(`${cwd}/${arg}`) };
  return null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const isLoopback = (host) => LOOPBACK.has((host ?? "").toLowerCase());

// Only ports from 1024 up are forwarded: below that are system services, never a dev server
// or a sign-in's callback.
function loopbackPort(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !isLoopback(url.hostname) || !url.port) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { port, host: url.hostname === "[::1]" ? "::1" : url.hostname.toLowerCase() };
}

// Parameters that carry a sign-in's redirect (OAuth's redirect_uri and its cousins), and those
// that carry another sign-in URL one level down (Google's `continue`, `next`).
const name = (k) => k.toLowerCase().replace(/[_-]/g, "");
const REDIRECT = new Set(["redirecturi", "redirecturl", "redirect", "redirectto", "callback", "callbackurl", "returnto", "returnurl"]);
const CARRIES = new Set([...REDIRECT, "continue", "next", "target", "url", "goto", "dest", "destination", "fromuri"]);

function params(url) {
  const out = [...url.searchParams.entries()];
  if (url.hash.length > 1) {
    try {
      out.push(...new URLSearchParams(url.hash.slice(1)).entries());
    } catch {
      // a fragment that isn't a query
    }
  }
  return out;
}

const callbackIn = (url) => {
  for (const [k, v] of params(url)) {
    if (!REDIRECT.has(name(k))) continue;
    const hit = loopbackPort(v);
    if (hit) return hit;
  }
  return null;
};

// The port a page needs forwarded from the machine it came from, if any: the page itself on
// localhost (a dev server), or a sign-in whose redirect goes back to localhost (OAuth, OIDC).
export function loopbackTarget(href) {
  const direct = loopbackPort(href);
  if (direct) return { ...direct, auth: false };
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const hit = callbackIn(url);
  if (hit) return { ...hit, auth: true };
  for (const [k, v] of params(url)) {
    if (!CARRIES.has(name(k)) || !/^https?:\/\//i.test(v)) continue;
    let inner;
    try {
      inner = new URL(v);
    } catch {
      continue;
    }
    const deep = callbackIn(inner);
    if (deep) return { ...deep, auth: true };
  }
  return null;
}

// The bids for request `id`: [{app, at}], `at` being when that Mac was last used.
export function bidsFor(labels, id) {
  const pre = `${BID}${id}.`;
  const out = [];
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (key.startsWith(pre) && key.length > pre.length) out.push({ app: key.slice(pre.length), at: Number(value) || 0 });
  }
  return out;
}

// The Herdr window used most recently takes it; equal times go to the first name.
export function winner(bids) {
  let best = null;
  for (const b of bids) if (!best || b.at > best.at || (b.at === best.at && b.app < best.app)) best = b;
  return best?.app ?? null;
}

export const ackOf = (labels, id) => (typeof labels?.[ackKey(id)] === "string" ? labels[ackKey(id)] : null);

// A label key part for this Mac: its host name, lower case, [a-z0-9-] only, and a random tag
// kept per install, since two Macs can share a host name.
export const appName = (host, tag = "") => `${baseAppName(host)}${tag ? `-${tag}` : ""}`;
const baseAppName = (host) => (host ?? "").trim().toLowerCase().replace(/\..*$/, "").replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "herdr";

// ---------------------------------------------------------------------------
// Files

// "1kx3f9-8d2c1a-shot.png": when it was copied, which file it was, and its own name, cleaned.
export function cacheName(machine, path, now) {
  const base = path.split("/").pop() || "file";
  const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(-80);
  return `${now.toString(36)}-${hash(`${machine ?? ""}:${path}`)}-${clean}`;
}

export const cacheTime = (name) => parseInt(name.split("-")[0], 36) || 0;

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// "shot.png", then "shot (2).png", "shot (3).png", …: the first name `taken` says is free.
export async function freeName(name, taken) {
  if (!(await taken(name))) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!(await taken(next))) return next;
  }
  return null;
}

export const parseSize = (wcOut) => {
  const n = parseInt(String(wcOut).trim().split(/\s+/)[0], 10);
  return Number.isFinite(n) ? n : null;
};

const B64 = new Int16Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => (B64[c.charCodeAt(0)] = i));

// Base64 to bytes; line breaks and padding are skipped (GNU base64 wraps at 76 columns).
export function decodeBase64(text) {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4) + 3);
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? B64[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const i32le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

// An image's size in pixels from its first bytes, or null when the format isn't known.
export function imageSize(b) {
  if (!b || b.length < 10) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b.length >= 24) return { w: u32be(b, 16), h: u32be(b, 20) };
  if (ascii(b, 0, 4) === "GIF8") return { w: u16le(b, 6), h: u16le(b, 8) };
  if (ascii(b, 0, 2) === "BM" && b.length >= 26) return { w: Math.abs(i32le(b, 18)), h: Math.abs(i32le(b, 22)) };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L") return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (chunk === "VP8X") return { w: 1 + u24le(b, 24), h: 1 + u24le(b, 27) };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        i += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  const head = ascii(b, 0, Math.min(b.length, 2048));
  if (/<svg[\s>]/i.test(head)) return svgSize(head);
  return null;
}

function svgSize(text) {
  const tag = text.match(/<svg[^>]*>/i)?.[0] ?? "";
  const num = (name) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i"));
    return m ? Number(m[1]) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return { w: Math.round(w), h: Math.round(h) };
  const vb = tag.match(/viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
  if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
  return { w: 800, h: 600 };
}

// The largest size of w×h that fits in maxW×maxH, never bigger than the image itself.
export function fit(w, h, maxW, maxH) {
  if (!(w > 0) || !(h > 0)) return { w: Math.max(0, Math.floor(maxW)), h: Math.max(0, Math.floor(maxH)) };
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)) };
}

// The viewer window's size for an image: room for the picture and the title bar, within
// what a laptop screen can show.
export function viewerSize(img, bar) {
  const inner = img ? fit(img.w, img.h, 1100, 760) : { w: 640, h: 420 };
  return { width: Math.max(380, inner.w + 2), height: Math.max(240, inner.h + bar + 2) };
}

// ---------------------------------------------------------------------------
// Image paths in a terminal's text, for the right-click menu

const EXT = IMAGE_EXTS.join("|");
const QUOTED = new RegExp(`(["'\`])((?:file://)?[^"'\`\\n]*?\\.(?:${EXT}))\\1`, "gi");
const BARE = new RegExp(`(?:file://)?(?:~/|\\.{1,2}/|/)?[A-Za-z0-9._@%+~-]*(?:/[A-Za-z0-9._@%+~-]+)*\\.(?:${EXT})(?![A-Za-z0-9])`, "gi");

// The path that ends at a bare match and starts at the nearest "/" or "~/" opening a word
// before it, when spaces lie between: null otherwise.
function withSpaces(line, at, bare) {
  for (let s = at - 1; s >= 0 && at - s <= 240; s--) {
    const c = line[s];
    if (`"'\`<>|`.includes(c)) return null;
    const opens = (c === "/" || (c === "~" && line[s + 1] === "/")) && (s === 0 || /[\s(=:]/.test(line[s - 1]));
    if (!opens) continue;
    const path = line.slice(s, at) + bare;
    return /\s/.test(line.slice(s, at)) ? path : null;
  }
  return null;
}

// The image paths printed in `text`, the most recent first, at most `max`. Relative ones are
// left relative: the machine they're on resolves them against the terminal's folder, and
// drops the ones that aren't files there.
export function imagePaths(text, max = 8) {
  const lines = String(text ?? "").split("\n");
  const seen = new Set();
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const found = [];
    const spans = [];
    for (const m of lines[i].matchAll(QUOTED)) {
      found.push({ at: m.index, path: m[2] });
      spans.push([m.index, m.index + m[0].length]);
    }
    // A quoted path's tail ("Shot.png" of "My Shot.png") isn't a path of its own.
    for (const m of lines[i].matchAll(BARE)) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      // An unquoted path with spaces ("/Users/x/Desktop/Screenshot … at 20.12.45.png") ends in a
      // bare match too: offer the path from where it starts on the line as well, first. The
      // machine keeps whichever is a file.
      const long = withSpaces(lines[i], m.index, m[0]);
      if (long) found.push({ at: m.index + 0.5, path: long });
      found.push({ at: m.index, path: m[0] });
    }
    found.sort((a, b) => b.at - a.at);
    for (const f of found) {
      let p = f.path;
      if (/^file:\/\//i.test(p)) {
        try {
          p = decodeURIComponent(new URL(p).pathname);
        } catch {
          continue;
        }
      }
      // "//host/x.png" is the end of a web link, not a file.
      if (!p || p.startsWith("//") || IMAGE_RE.test(`x${p}`) === false || hasControl(p) || seen.has(p)) continue;
      if (/^\.[A-Za-z]+$/.test(p)) continue; // a bare ".png"
      seen.add(p);
      out.push(p);
      if (out.length >= max) break;
    }
  }
  return out;
}

export const baseName = (path) => path.split("/").filter(Boolean).pop() ?? path;

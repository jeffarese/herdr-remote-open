import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../mods/remote-open/model.js";

const req = (o = {}) => JSON.stringify({ v: 1, id: "a1b2c3d4e5f6", t: 1795180000000, arg: "https://example.com/", cwd: "/home/sandbox/app", ...o });

test("a request is read only when it is well formed", () => {
  assert.deepEqual(m.parseRequest(req()), { id: "a1b2c3d4e5f6", t: 1795180000000, arg: "https://example.com/", cwd: "/home/sandbox/app" });
  assert.equal(m.parseRequest("not json"), null);
  assert.equal(m.parseRequest(req({ v: 2 })), null);
  assert.equal(m.parseRequest(req({ id: "../x" })), null);
  assert.equal(m.parseRequest(req({ arg: "a\nb" })), null);
  assert.equal(m.parseRequest(req({ arg: "" })), null);
  assert.equal(m.parseRequest(req({ cwd: "relative" })).cwd, null);
  assert.equal(m.parseRequest("x".repeat(20000)), null);
  assert.equal(m.parseRequest(undefined), null);
});

test("an argument is a page or a file on the terminal's machine", () => {
  assert.deepEqual(m.classify("https://example.com/a?b=1", null), { kind: "web", url: "https://example.com/a?b=1" });
  assert.deepEqual(m.classify("HTTP://Example.com", null), { kind: "web", url: "http://example.com/" });
  assert.deepEqual(m.classify("file:///home/x/My%20Shot.png", null), { kind: "file", path: "/home/x/My Shot.png" });
  assert.deepEqual(m.classify("file://localhost/tmp/a.png", null), { kind: "file", path: "/tmp/a.png" });
  assert.equal(m.classify("file://otherhost/tmp/a.png", null), null);
  assert.deepEqual(m.classify("/tmp/../tmp/./a.png", null), { kind: "file", path: "/tmp/a.png" });
  assert.deepEqual(m.classify("out/chart.png", "/home/x/app"), { kind: "file", path: "/home/x/app/out/chart.png" });
  assert.equal(m.classify("out/chart.png", null), null);
  assert.equal(m.classify("mailto:a@b.c", "/"), null);
  assert.equal(m.classify("vscode://file/x", "/"), null);
});

test("a page on the other machine's localhost needs its port", () => {
  assert.deepEqual(m.loopbackTarget("http://localhost:5173/"), { port: 5173, host: "localhost", auth: false });
  assert.deepEqual(m.loopbackTarget("http://127.0.0.1:8765/report.html"), { port: 8765, host: "127.0.0.1", auth: false });
  assert.deepEqual(m.loopbackTarget("http://[::1]:3000"), { port: 3000, host: "::1", auth: false });
  assert.equal(m.loopbackTarget("http://localhost/"), null, "no port: nothing to forward");
  assert.equal(m.loopbackTarget("http://localhost:631/"), null, "system ports never");
  assert.equal(m.loopbackTarget("https://example.com/"), null);
});

test("a sign-in whose redirect comes back to localhost needs the callback port", () => {
  const google = "https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A8085%2F&scope=openid";
  assert.deepEqual(m.loopbackTarget(google), { port: 8085, host: "localhost", auth: true });
  const loopback = "https://auth.openai.com/oauth/authorize?redirect_uri=http://127.0.0.1:1455/auth/callback&state=abc";
  assert.deepEqual(m.loopbackTarget(loopback), { port: 1455, host: "127.0.0.1", auth: true });
  const fragment = "https://idp.example/#redirect_url=http%3A%2F%2Flocalhost%3A9000%2Fcb";
  assert.deepEqual(m.loopbackTarget(fragment), { port: 9000, host: "localhost", auth: true });
  const nested = `https://login.example/continue?next=${encodeURIComponent("https://idp.example/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A4321%2Fcb")}`;
  assert.deepEqual(m.loopbackTarget(nested), { port: 4321, host: "localhost", auth: true });
  assert.equal(m.loopbackTarget("https://idp.example/authorize?redirect_uri=https%3A%2F%2Fapp.example%2Fcb"), null);
  assert.deepEqual(m.loopbackTarget("https://idp.example/a?redirectUri=http://localhost:7777/cb"), { port: 7777, host: "localhost", auth: true }, "camelCase too");
  // Only parameters that carry a redirect: a page can't take a port by naming it anywhere.
  assert.equal(m.loopbackTarget("https://x.example/?a=http://localhost:6379"), null);
  assert.equal(m.loopbackTarget(`https://x.example/?q=${encodeURIComponent("https://y.example/?a=http://localhost:5432")}`), null);
  assert.equal(m.loopbackTarget("https://idp.example/a?redirect_uri=http://localhost:22/cb"), null);
});

test("the window used last wins; a tie goes to the first name", () => {
  const labels = { [m.bidKey("id1", "mac-a")]: "100", [m.bidKey("id1", "mac-b")]: "300", [m.bidKey("id2", "mac-c")]: "999", other: "x" };
  const bids = m.bidsFor(labels, "id1");
  assert.deepEqual(bids, [{ app: "mac-a", at: 100 }, { app: "mac-b", at: 300 }]);
  assert.equal(m.winner(bids), "mac-b");
  assert.equal(m.winner([{ app: "b", at: 5 }, { app: "a", at: 5 }]), "a");
  assert.equal(m.winner([]), null);
  assert.equal(m.ackOf({ [m.ackKey("id1")]: "mac-b" }, "id1"), "mac-b");
  assert.equal(m.ackOf({ [m.ackKey("id2")]: "mac-b" }, "id1"), null);
  assert.equal(m.appName("Jeffs-MBP.local", "3f9a01"), "jeffs-mbp-3f9a01");
});

test("each request lives under its own id", () => {
  const ok = JSON.stringify({ v: 1, id: "abcdef12", t: 1, arg: "https://x.example/", cwd: "/" });
  const labels = { [m.reqKey("abcdef12")]: ok, [m.reqKey("00000000")]: ok, [m.reqKey("12345678")]: "not json", other: ok };
  assert.deepEqual(m.requestsIn(labels).map((r) => r.id), ["abcdef12"], "the id in the key must match the one inside");
});

test("addresses, host names and paths", () => {
  assert.deepEqual(m.splitAddress("studio/t5"), { machine: "studio", id: "t5" });
  assert.deepEqual(m.splitAddress("t5"), { machine: null, id: "t5" });
  assert.equal(m.appName("Jeffs-MacBook-Pro.local\n"), "jeffs-macbook-pro");
  assert.equal(m.appName("weird name!"), "weird-name-");
  assert.equal(m.appName(""), "herdr");
  assert.equal(m.normalize("/a/b/../c/./d"), "/a/c/d");
  assert.equal(m.normalize("/../.."), "/");
  assert.equal(m.baseName("/a/b/shot.png"), "shot.png");
  assert.equal(m.isImage("/x/Y.JPG"), true);
  assert.equal(m.isImage("/x/report.pdf"), false);
  assert.equal(m.opensHere("/x/report.pdf"), true);
  assert.equal(m.opensHere("/x/page.HTML"), false, "a page's scripts would run from a local file");
  assert.equal(m.opensHere("/x/notes.MD"), true);
  assert.equal(m.isMarkdown("/x/notes.MD"), true);
  assert.equal(m.isMarkdown("/x/guide.markdown"), true);
  assert.equal(m.isMarkdown("/x/page.mdx"), false);
  assert.equal(m.isDocument("/x/notes.md"), false, "markdown has its own viewer");
  assert.equal(m.isViewable("/x/a.png") && m.isViewable("/x/a.md") && !m.isViewable("/x/a.pdf"), true);
  for (const p of ["/x/run.command", "/x/App.app", "/x/a.terminal", "/x/script.sh", "/x/noext"]) assert.equal(m.opensHere(p), false, p);
  assert.equal(m.parseSize("   1234 /x/y\n"), 1234);
  assert.equal(m.parseSize("1234 /x/y"), 1234);
  assert.equal(m.parseSize("wc: nope"), null);
});

test("cache names say when and what, and keep only safe characters", () => {
  const name = m.cacheName("studio", "/home/x/my shot (1).png", 1795180000000);
  assert.match(name, /^[0-9a-z]+-[0-9a-f]{8}-my_shot__1_\.png$/);
  assert.equal(m.cacheTime(name), 1795180000000);
  assert.notEqual(m.cacheName("a", "/p.png", 1), m.cacheName("b", "/p.png", 1));
  assert.match(m.cacheName(null, "/x/.hidden.png", 1), /-_hidden\.png$/);
});

test("a free name in Downloads never replaces a file", async () => {
  const taken = new Set(["shot.png", "shot (2).png"]);
  assert.equal(await m.freeName("shot.png", async (n) => taken.has(n)), "shot (3).png");
  assert.equal(await m.freeName("new.png", async (n) => taken.has(n)), "new.png");
  assert.equal(await m.freeName("README", async (n) => n === "README"), "README (2)");
});

test("base64 decodes as Node does, line breaks and all", () => {
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256));
  const wrapped = bytes.toString("base64").replace(/(.{76})/g, "$1\n");
  assert.deepEqual(Buffer.from(m.decodeBase64(wrapped)), bytes);
  for (const n of [0, 1, 2, 3, 4, 5]) assert.deepEqual(Buffer.from(m.decodeBase64(bytes.subarray(0, n).toString("base64"))), bytes.subarray(0, n));
});

function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test("an image's size comes from its header", () => {
  assert.deepEqual(m.imageSize(png(2880, 1800)), { w: 2880, h: 1800 });
  const gif = Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1");
  assert.deepEqual(m.imageSize(gif), { w: 320, h: 240 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0]);
  assert.deepEqual(m.imageSize(jpeg), { w: 640, h: 480 });
  const bmp = Buffer.alloc(30);
  bmp.write("BM", 0);
  bmp.writeInt32LE(100, 18);
  bmp.writeInt32LE(-50, 22);
  assert.deepEqual(m.imageSize(bmp), { w: 100, h: 50 });
  const vp8x = Buffer.alloc(30);
  vp8x.write("RIFF", 0);
  vp8x.write("WEBP", 8);
  vp8x.write("VP8X", 12);
  vp8x.writeUIntLE(1919, 24, 3);
  vp8x.writeUIntLE(1079, 27, 3);
  assert.deepEqual(m.imageSize(vp8x), { w: 1920, h: 1080 });
  assert.deepEqual(m.imageSize(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">')), { w: 120, h: 80 });
  assert.deepEqual(m.imageSize(Buffer.from('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">')), { w: 24, h: 24 });
  assert.equal(m.imageSize(Buffer.from("not an image at all")), null);
  assert.equal(m.imageSize(null), null);
});

test("an image fits without growing, and the viewer leaves room for its bar", () => {
  assert.deepEqual(m.fit(2000, 1000, 1000, 1000), { w: 1000, h: 500 });
  assert.deepEqual(m.fit(100, 50, 1000, 1000), { w: 100, h: 50 });
  assert.deepEqual(m.viewerSize({ w: 2880, h: 1800 }, 36), { width: 1102, height: 725 });
  assert.deepEqual(m.viewerSize({ w: 16, h: 16 }, 36), { width: 380, height: 240 });
  assert.deepEqual(m.viewerSize(null, 36), { width: 642, height: 458 });
});

test("image paths a terminal printed, newest first", () => {
  const text = [
    "Saved /home/x/old.png",
    "see https://cdn.example.com/banner.png for the banner",
    "wrote out/chart.svg and ./diff.webp",
    "Screenshot: '/home/x/My Shot.png'",
    "file:///tmp/a%20b.jpg",
    "build 1.2.3 done, .png",
    "--out=report.jpeg",
  ].join("\n");
  assert.deepEqual(m.filePaths(text), ["report.jpeg", "/tmp/a b.jpg", "/home/x/My Shot.png", "./diff.webp", "out/chart.svg", "/home/x/old.png"]);
  assert.deepEqual(m.filePaths(text, 2), ["report.jpeg", "/tmp/a b.jpg"]);
  assert.deepEqual(m.filePaths("nothing here"), []);
  assert.deepEqual(m.filePaths("~/Desktop/x.png"), ["~/Desktop/x.png"]);
  // A macOS screenshot's name has spaces and isn't quoted: the whole path is offered first.
  assert.deepEqual(m.filePaths("   /Users/me/Desktop/Screenshot 2026-09-22 at 20.12.45.png"), ["/Users/me/Desktop/Screenshot 2026-09-22 at 20.12.45.png", "20.12.45.png"]);
  assert.deepEqual(m.filePaths("open ~/Shots/a b.png now"), ["~/Shots/a b.png", "b.png"]);
  assert.deepEqual(m.filePaths("see /tmp/x.png"), ["/tmp/x.png"], "no spaces: one path");
});

test("markdown paths are found beside image paths", () => {
  const text = ["Write(~/weekly-updates/2026-11-21-flowie/notes.md)", "  L Wrote 31 lines to /Users/me/weekly-updates/2026-11-21-flowie/notes.md", "see shot.png, page.mdx and guide.markdown"].join("\n");
  assert.deepEqual(m.filePaths(text), ["guide.markdown", "shot.png", "/Users/me/weekly-updates/2026-11-21-flowie/notes.md", "~/weekly-updates/2026-11-21-flowie/notes.md"]);
  assert.deepEqual(m.filePaths("a bare .md"), []);
});

test("UTF-8 decodes, with a replacement for what isn't UTF-8", () => {
  const enc = (s) => [...Buffer.from(s, "utf8")];
  assert.equal(m.decodeUtf8(enc("plain # text")), "plain # text");
  assert.equal(m.decodeUtf8(enc("Caf\u00e9 \u2014 \u{1F600}")), "Caf\u00e9 \u2014 \u{1F600}");
  assert.equal(m.decodeUtf8([0xef, 0xbb, 0xbf, 0x41]), "A", "a BOM is dropped");
  assert.equal(m.decodeUtf8([0x41, 0xff, 0x42, 0xc3]), "A\ufffdB\ufffd");
  assert.equal(m.decodeUtf8([0xed, 0xa0, 0x80]), "\ufffd\ufffd\ufffd", "no lone surrogates");
});

test("each runs every item, at most so many at a time", async () => {
  let now = 0;
  let most = 0;
  const seen = [];
  await m.each([1, 2, 3, 4, 5, 6, 7], 3, async (x, i) => {
    most = Math.max(most, ++now);
    await new Promise((r) => setTimeout(r, 2));
    seen.push([x, i]);
    now--;
  });
  assert.equal(most, 3);
  assert.deepEqual(seen.map(([x]) => x).sort(), [1, 2, 3, 4, 5, 6, 7]);
  await m.each([], 4, async () => assert.fail("nothing to run"));
});

test("the gallery counts images and markdown files apart", () => {
  assert.equal(m.galleryCount([]), "");
  assert.equal(m.galleryCount([{ kind: "image" }]), "1 image");
  assert.equal(m.galleryCount([{ kind: "image" }, { kind: "image" }, { kind: "markdown" }]), "2 images, 1 markdown file");
  assert.equal(m.galleryCount([{ kind: "markdown" }, { kind: "markdown" }]), "2 markdown files");
  assert.equal(m.thumbName(null, "/tmp/My Shot.png", 0), `0-${m.cacheName(null, "/tmp/My Shot.png", 0).split("-")[1]}-My_Shot.png.thumb.png`);
});

// A ⌘-click as Herdr hands it to link.js.
const click = (link, source = {}) => ({ link, source: { terminal: "studio/t6", machine: "studio", cwd: "/home/sandbox/app", pane: "p1", tab: "tb1", space: "sp1", ...source } });
const url = (u) => ({ kind: "url", raw: u, url: u });
const file = (raw, more = {}) => ({ kind: "file", raw, path: null, ...more });

test("a ⌘-click is ours for another machine's localhost page, sign-in or viewable file", () => {
  assert.deepEqual(m.linkTarget(click(url("http://localhost:5173/x?y=1"))), { kind: "web", machine: "studio", url: "http://localhost:5173/x?y=1" });
  const signIn = "https://accounts.example/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A8085%2Fcb";
  assert.deepEqual(m.linkTarget(click(url(signIn))), { kind: "web", machine: "studio", url: signIn });
  // Relative to the terminal's folder, with where in the file taken off.
  assert.deepEqual(m.linkTarget(click(file("runs/w46/loss.png"))), { kind: "file", machine: "studio", path: "/home/sandbox/app/runs/w46/loss.png" });
  assert.equal(m.linkTarget(click(file("./notes.md:12:3", { line: 12, column: 3 }))).path, "/home/sandbox/app/notes.md");
  assert.equal(m.linkTarget(click(file("docs/plan.md#L5-L12", { line: 5 }))).path, "/home/sandbox/app/docs/plan.md");
  assert.equal(m.linkTarget(click(file("/var/log/app.log:5-12", { line: 5 }))).path, "/var/log/app.log");
  assert.equal(m.linkTarget(click(file("file:///tmp/a%20b.pdf"))).path, "/tmp/a b.pdf");
  // Its machine expands "~".
  assert.equal(m.linkTarget(click(file("~/shots/Screenshot 1.png"))).path, "~/shots/Screenshot 1.png");
  // The machine comes from the terminal's address when Herdr doesn't name it.
  assert.equal(m.linkTarget(click(file("/tmp/a.png"), { machine: undefined })).machine, "studio");
});

test("every other ⌘-click stays Herdr's", () => {
  const here = { terminal: "t4", machine: null };
  assert.equal(m.linkTarget(click(url("http://localhost:5173/"), here)), null, "this Mac's localhost is this Mac's");
  assert.equal(m.linkTarget(click(file("/tmp/a.png", { path: "/tmp/a.png" }), here)), null);
  assert.equal(m.linkTarget(click(url("https://example.com/localhost"))), null, "an ordinary page");
  assert.equal(m.linkTarget(click(url("http://localhost/"))), null, "no port to forward");
  assert.equal(m.linkTarget(click(url("http://localhost:80/"))), null);
  assert.equal(m.linkTarget(click(file("build/index.html"))), null, "nothing that can run");
  assert.equal(m.linkTarget(click(file("run.sh:3", { line: 3 }))), null);
  assert.equal(m.linkTarget(click(file("runs/loss.png"), { cwd: null })), null, "nowhere to resolve it against");
  assert.equal(m.linkTarget(click(file("a\u0007.png"))), null);
  assert.equal(m.linkTarget(click({ kind: "mail", raw: "mailto:a@example.com" })), null);
  assert.equal(m.linkTarget(null), null);
  assert.equal(m.linkTarget({ link: url("http://localhost:5173/") }), null);
});

test("waiting clicks are read back only when they are whole", () => {
  const web = { id: "a", at: 5, kind: "web", machine: "studio", url: "http://localhost:5173/" };
  const png = { id: "b", at: 6, kind: "file", machine: "studio", path: "~/a.png" };
  assert.deepEqual(m.parseClicks(JSON.stringify([web, png])), [web, png]);
  assert.deepEqual(m.parseClicks(null), []);
  assert.deepEqual(m.parseClicks("not json"), []);
  assert.deepEqual(m.parseClicks('{"id":"a"}'), []);
  const bad = [{ ...web, url: "javascript:alert(1)" }, { ...png, path: "relative.png" }, { ...png, path: "/tmp/run.sh" }, { ...web, machine: "" }, { ...web, at: "now" }, null];
  assert.deepEqual(m.parseClicks(JSON.stringify(bad)), []);
});

test("mod.json's link rules reach link.js with every click that could be ours", async () => {
  const { readFileSync } = await import("node:fs");
  const mod = JSON.parse(readFileSync(new URL("../mods/remote-open/mod.json", import.meta.url), "utf8"));
  // Rust's "(?i)" is JavaScript's i flag.
  const rule = (kind) => {
    const pattern = mod.link_handlers.find((r) => r.kind === kind).pattern;
    assert.ok(pattern.startsWith("(?i)"));
    return new RegExp(pattern.slice(4), "i");
  };
  for (const ext of [...m.IMAGE_EXTS, ...m.MARKDOWN_EXTS, ...m.DOC_EXTS]) {
    assert.ok(rule("file").test(`/tmp/a.${ext}`), ext);
    assert.ok(rule("file").test(`/tmp/A.${ext.toUpperCase()}`), ext);
  }
  assert.equal(rule("file").test("/tmp/a.html"), false);
  const pages = [
    "http://localhost:5173/",
    "http://127.0.0.1:8080/x",
    "http://[::1]:3000/",
    "https://accounts.example/auth?redirect_uri=http%3A%2F%2Flocalhost%3A8085%2F",
    "https://accounts.example/auth?redirect_uri=http://127.0.0.1:8085/",
    "https://accounts.example/auth?redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A8085%2F",
    "https://accounts.example/a?continue=https%3A%2F%2Fb.example%2Fc%3Fredirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8085",
  ];
  for (const page of pages) assert.ok(rule("url").test(page), page);
  assert.equal(rule("url").test("https://example.com/docs"), false);
  // The palette's own command is one the watcher answers.
  assert.deepEqual(mod.palette.map((p) => p.command), ["mod.open", "remote-open.gallery"]);
});

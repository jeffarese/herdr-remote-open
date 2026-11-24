// remote-open: links and files that programs on other machines open come up on this Mac.
//
// A program in a terminal on another machine opens a page or a file through `herdr-open` (its
// BROWSER, and its xdg-open on Linux), which puts a request on its terminal as a label. Every
// Herdr window sees the label; the one the person used last takes it, says so with another
// label (model.js lists the keys), and opens it here: a page in the browser, with the port forwarded over ssh when it's
// on that machine's localhost or is a sign-in's callback; an image or a markdown file in a
// floating viewer; any other file in its Mac app. A ⌘-click on a link or a path in another
// machine's terminal asks the same of it, through link.js.
//
// One mod, six kinds of copy, told apart by their props:
//   (none)            the floating block: watches for requests and ⌘-clicks, shows forwarded
//                     ports (key command: gallery, for the focused terminal; "gallery:t7" for t7)
//   { tab: "pane" }   the terminal right-click menu (layout root "terminal_menu")
//   { view: "image" } the image viewer window (key commands: close, fit)
//   { view: "markdown" } the markdown viewer window (key command: close)
//   { view: "gallery" } every image the terminal printed, as tiles (key command: close-gallery)
//   { view: "forwards" }, or opened by mod.open: the list of forwarded ports

import { View, div } from "gpui-kit";
import { props, run, closeOverlay, openOverlay, terminals, panes, keys, notify, checking, nextCommand, focused, window as appWindow } from "herdr";
import * as m from "./model.js";
import * as host from "./host.js";
import * as views from "./views.js";

// Shared by every copy of this build. `owner`/`beat`: which floating copy is the watcher now
// (a timestamp that goes stale, never a promise, so a closed copy can't hold it). `seen`:
// request id → when it was first and last seen. `keys`: when each remote-open label was first
// seen, to sweep the ones left behind. `shown`: the image the viewer opened last, which the
// gallery steps on from.
const S = { owner: null, beat: 0, inbox: [], seen: new Map(), keys: new Map(), me: null, lastUse: 0, wasActive: false, shown: null };
export const _state = S; // for the tests
const WATCH_MS = 300;
const OWNER_MS = 2000;

const roleOf = (p) => {
  if (p?.view === "image") return "viewer";
  if (p?.view === "markdown") return "markdown";
  if (p?.view === "gallery") return "gallery";
  if (p?.view === "forwards") return "forwards";
  if (p?.tab === "pane") return "menu";
  if (p?.tab) return "other-menu";
  return p?.overlay ? "forwards" : "watcher";
};

// The key bound to a command, as the shipped menu shows it.
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

const fail = (title, e) => notify({ title, body: host.message(e), level: "error" });
const cwdOf = (term) => term?.foreground?.cwd ?? term?.cwd ?? null;

export default class RemoteOpen extends View {
  init(_props, cx) {
    this.role = roleOf(props());
    if (this.role === "watcher") return this.initWatcher(cx);
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.role === "viewer" || this.role === "markdown") {
      this.fit = true;
      this.body = null;
      this.note = null;
      if (this.role === "viewer") S.shown = { machine: props()?.machine ?? null, path: props()?.path ?? null };
      // A key bound to "remote-open:close" (or `herdr-app do remote-open.close`) closes it.
      if (!checking())
        cx.spawn(async (cx) => {
          for (;;) {
            const c = await nextCommand();
            if (c === "close") closeOverlay(props()?.overlay);
            else if (c === "fit" && this.role === "viewer") {
              this.fit = !this.fit;
              cx.notify();
            }
          }
        });
    } else if (this.role === "menu") {
      this.at = 0;
      this.files = [];
      this.count = 0;
      this.busy = null;
      const term = this.term();
      if (term && !checking())
        cx.spawn(async (cx) => {
          // All of them on the screen, for the gallery row's count; the newest few get rows.
          const found = await host.terminalFiles(term.address, cwdOf(term), m.GALLERY_MAX).catch(() => []);
          this.files = found.slice(0, m.MENU_FILES);
          this.count = found.length;
          cx.notify();
        });
    } else if (this.role === "gallery") {
      this.initGallery(cx);
    } else if (this.role === "other-menu") {
      closeOverlay(props()?.overlay);
    } else if (this.role === "forwards") {
      // Checked again each time it opens: a forward that died since isn't listed, and each one
      // says whether it's in use.
      if (!checking()) cx.spawn(async (cx) => {
        await host.checkForwards();
        cx.notify();
      });
      cx.timer.every(10_000, (cx) => cx.notify());
    }
  }

  // -------------------------------------------------------------------------
  // The watcher

  initWatcher(cx) {
    this.token = Symbol("watcher");
    this.armed = false;
    this.shown = -1;
    this.minute = 0;
    this.swept = 0;
    this.checked = Date.now();
    if (checking()) return;
    cx.spawn(async (cx) => {
      const me = await host.myName();
      S.me ??= me;
      // Requests already there when this starts aren't new: a window that just opened doesn't
      // answer something another one was asked a while ago.
      this.scan(cx, false);
      this.armed = true;
      cx.notify();
    });
    // Not waited for: a copy that closes mid-load mustn't hold this one up.
    cx.spawn(async (cx) => {
      await host.loadForwards();
      cx.notify();
    });
    host.sweepCache().catch(() => {});
    cx.timer.every(WATCH_MS, (cx) => this.tick(cx));
    // Every copy gets each command: only the watcher on duty answers.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (S.owner === this.token) this.command(c);
      }
    });
  }

  // "gallery" opens the gallery of the focused terminal (or the one shown in its place),
  // "gallery:<address>" that terminal's. Other commands are the viewers'.
  command(c) {
    const [name, address] = String(c).split(/:(.+)/);
    if (name !== "gallery") return;
    const f = focused();
    const target = address || f?.shown || f?.terminal;
    const term = target && terminals().find((t) => t.address === target);
    if (term) host.openGallery(term.address, cwdOf(term));
    else notify({ title: "No terminal for the gallery", body: address ? `There's no terminal ${address}.` : "Focus a terminal first.", level: "error", timeout: 4000 });
  }

  tick(cx) {
    this.redraw(cx);
    // Only a copy that is ready takes the watch, so one stuck starting can't hold it.
    if (!this.armed) return;
    const now = Date.now();
    if (S.owner !== this.token && now - S.beat < OWNER_MS) return;
    S.owner = this.token;
    S.beat = now;
    const active = appWindow()?.active === true;
    // Leaving Herdr for another app is the last moment the person used this window.
    if (S.wasActive && !active) S.lastUse = now;
    S.wasActive = active;
    this.scan(cx, true);
    // What the menu and link.js (⌘-clicks) left for this copy to do.
    S.inbox.push(...host.takeClicks());
    while (S.inbox.length) {
      const job = S.inbox.shift();
      if (now - job.at < 15_000) cx.spawn((cx) => host.openTarget(job, cx).catch((e) => fail(`Couldn't open ${host.targetName(job)}`, e)));
    }
    if (now - this.swept > 5000) {
      this.swept = now;
      this.sweepLabels(cx);
    }
    if (now - this.checked > m.CHECK_MS) {
      this.checked = now;
      cx.spawn(() => host.checkForwards().catch(() => {}));
    }
  }

  // Every copy draws its chip again when the forwards change, the one on duty or not.
  redraw(cx) {
    const minute = Math.floor(Date.now() / 30_000);
    if (host.expire() || host.forwardsVersion() !== this.shown || (minute !== this.minute && host.forwards().some((r) => r.until))) {
      this.shown = host.forwardsVersion();
      this.minute = minute;
      cx.notify();
    }
  }

  // New requests are taken; one stays seen for as long as its label is there, so a request left
  // behind is never answered late.
  scan(cx, act) {
    const now = Date.now();
    for (const t of terminals()) {
      for (const req of m.requestsIn(t.labels)) {
        const seen = S.seen.get(req.id);
        S.seen.set(req.id, { first: seen?.first ?? now, last: now });
        if (!seen && act) cx.spawn((cx) => this.take(t.address, req, now, cx));
      }
    }
    for (const [id, at] of S.seen) if (now - at.last > 600_000) S.seen.delete(id);
  }

  // remote-open labels still there long after herdr-open stopped waiting were left behind (one
  // that was killed, a Mac that slept mid-answer): take them off.
  sweepLabels(cx) {
    const now = Date.now();
    const live = new Set();
    for (const t of terminals()) {
      const stale = [];
      for (const key of Object.keys(t.labels ?? {})) {
        if (!key.startsWith(m.PREFIX)) continue;
        const k = `${t.address} ${key}`;
        live.add(k);
        if (!S.keys.has(k)) S.keys.set(k, now);
        else if (now - S.keys.get(k) > m.STALE_MS) stale.push(`${key}=`);
      }
      if (stale.length) cx.spawn(() => host.setLabels(t.address, stale));
    }
    for (const k of S.keys.keys()) if (!live.has(k)) S.keys.delete(k);
  }

  // When someone last used Herdr on this Mac: now minus the Mac's idle time while Herdr is the
  // app in front, else the moment they left it.
  async lastUse() {
    if (appWindow()?.active) S.lastUse = Math.max(S.lastUse, Date.now() - (await host.idleMs()));
    return S.lastUse;
  }

  // Every Mac showing the terminal bids when someone last used Herdr there; the latest wins and
  // acks. Two Macs can ack at the same moment: the label keeps the last write, so each reads it
  // back and only the one named there opens it. herdr-open writes "-" there when it gives up.
  async take(address, req, seenAt, cx) {
    const target = m.classify(req.arg, req.cwd);
    // Not for us (another scheme, a kind of file that could run something): its machine opens it.
    if (!target || (target.kind === "file" && !m.opensHere(target.path))) return;
    const me = S.me;
    if (!me) return;
    const use = await this.lastUse();
    // In use right now: a short wait, enough for another Mac in use to bid as well.
    const inUse = appWindow()?.active === true && Date.now() - use < 30_000;
    const bid = m.bidKey(req.id, me);
    if (!(await host.setLabels(address, [`${bid}=${use}`]))) return;
    let won = false;
    try {
      await cx.sleep(inUse ? 150 : 800);
      let labels = await host.labelsNow(address);
      if (!labels?.[m.reqKey(req.id)] || m.ackOf(labels, req.id)) return; // gone, or taken
      if (m.winner(m.bidsFor(labels, req.id)) !== me) return;
      if (Date.now() - seenAt > m.TAKE_WITHIN) return; // herdr-open is about to give up
      if (!(await host.setLabels(address, [`${m.ackKey(req.id)}=${me}`]))) return;
      await cx.sleep(300);
      labels = await host.labelsNow(address);
      won = m.ackOf(labels, req.id) === me;
    } finally {
      host.setLabels(address, [`${bid}=`]);
    }
    if (!won) return;
    cx.spawn(async (cx) => {
      await cx.sleep(5000);
      await host.setLabels(address, [`${m.ackKey(req.id)}=`]);
    });
    const { machine } = m.splitAddress(address);
    try {
      if (target.kind === "web") await host.openWeb(machine, target.url, cx);
      else await host.openFile(machine, target.path);
    } catch (e) {
      fail(target.kind === "web" ? "Couldn't open the link" : `Couldn't open ${m.baseName(target.path)}`, e);
    }
  }

  // -------------------------------------------------------------------------
  // The menu

  term() {
    const address = props()?.target?.terminal;
    return address ? terminals().find((t) => t.address === address) ?? null : null;
  }

  items() {
    const tg = props()?.target ?? {};
    const all = terminals();
    const term = all.find((t) => t.address === tg.terminal);
    const parent = term?.parent && all.find((t) => t.address === term.parent);
    const toProgram = term?.labels?.["herdr.right-click"] === "program";
    // A terminal shown outside a tab (a layout block, a window) has no pane to split or close.
    const inTab = panes().some((pane) => pane.pane === tg.pane);
    const { machine } = m.splitAddress(term?.address ?? "");
    const files = this.files.map((path) => ({ label: `Open ${m.baseName(path)}`, tip: machine ? `${machine}: ${path}` : path, file: m.isMarkdown(path) ? "markdown" : "image", job: { kind: "file", machine, path }, busy: this.busy === path }));
    // Every image it printed, scrolled away ones too: the screen's count, as far as it knows yet.
    if (term) files.push({ label: "All images…", tip: "Every image and markdown file this terminal printed", file: "gallery", gallery: true, hint: this.count ? String(this.count) : "" });
    const pane = [
      ...(inTab
        ? [
            { label: "Split right", icon: "panel-right", cmd: "pane.split", args: { direction: "right", pane: tg.pane } },
            { label: "Split down", icon: "panel-right", cmd: "pane.split", args: { direction: "down", pane: tg.pane } },
            { label: "Zoom", icon: "square", cmd: "pane.zoom", args: { pane: tg.pane } },
          ]
        : []),
      ...(term
        ? [
            toProgram
              ? { label: "Use Herdr right-click menu", icon: "terminal", cmd: "terminal.right_click", args: { terminal: term.address, to: "menu" } }
              : { label: "Send right-clicks to pane", icon: "terminal", cmd: "terminal.right_click", args: { terminal: term.address, to: "program" } },
          ]
        : []),
      ...(parent ? [{ label: `Send back to ${parent.name || parent.address}`, icon: "terminal", cmd: "terminal.park", args: { terminal: term.address } }] : []),
      ...(inTab ? [{ label: "Close pane", icon: "x", cmd: "pane.close", args: { pane: tg.pane }, sep: true }] : []),
    ];
    if (files.length && pane.length) pane[0] = { ...pane[0], sep: true };
    return [...files, ...pane].map((it) => ({ ...it, hint: it.cmd ? shortcut(it.cmd, it.args) : (it.hint ?? "") }));
  }

  choose(i, cx) {
    const it = this.items()[i];
    if (!it || this.busy) return;
    const overlay = props()?.overlay;
    if (it.gallery) {
      const term = this.term();
      closeOverlay(overlay);
      if (term) host.openGallery(term.address, cwdOf(term));
      return;
    }
    if (it.job) {
      // The watcher does it, so closing this menu doesn't drop the copy halfway.
      if (Date.now() - S.beat < OWNER_MS) {
        S.inbox.push({ ...it.job, at: Date.now() });
        closeOverlay(overlay);
        return;
      }
      // No watcher in this layout: copy it from here, then close.
      this.busy = it.job.path;
      cx.notify();
      cx.spawn(async () => {
        await host.openFile(it.job.machine, it.job.path).catch((e) => fail(`Couldn't open ${m.baseName(it.job.path)}`, e));
        closeOverlay(overlay);
      });
      return;
    }
    closeOverlay(overlay);
    run(it.cmd, it.args);
  }

  menuKey(e, cx) {
    const n = this.items().length || 1;
    if (e.key === "down") this.at = (this.at + 1) % n;
    else if (e.key === "up") this.at = (this.at + n - 1) % n;
    else if (e.key === "enter") return this.choose(this.at, cx);
    else if (e.key === "escape") return closeOverlay(props()?.overlay);
    else return;
    cx.notify();
  }

  // -------------------------------------------------------------------------
  // The gallery: what's on the screen shows at once, then what history adds (a read that takes
  // seconds for the terminal on screen, and adds nothing for a program on the alternate screen,
  // as Claude Code's fullscreen view is). Each image gets its tile's picture from sips, four at
  // a time. Closing the window drops whatever is still loading, which nobody is waiting for.

  initGallery(cx) {
    this.tiles = [];
    this.phase = "screen";
    this.busy = null;
    this.gen = 0;
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "close-gallery") closeOverlay(props()?.overlay);
    });
    this.loadGallery(cx);
  }

  loadGallery(cx) {
    const gen = ++this.gen;
    const p = props() ?? {};
    const cwd = cwdOf(terminals().find((t) => t.address === p.terminal)) ?? p.cwd ?? null;
    this.tiles = [];
    this.phase = "screen";
    this.busy = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const screen = await host.terminalFiles(p.terminal, cwd, m.GALLERY_MAX).catch(() => []);
      if (gen !== this.gen) return;
      this.place(screen, gen, cx);
      this.phase = "history";
      cx.notify();
      const all = await host.terminalFiles(p.terminal, cwd, m.GALLERY_MAX, m.HISTORY_LINES).catch(() => []);
      if (gen !== this.gen) return;
      this.place(all, gen, cx);
      this.phase = "done";
      cx.notify();
    });
  }

  // Tiles in the order the files were printed (`newestFirst` is terminalFiles' order). Ones
  // already there keep their pictures, and ones this read missed stay, at the end.
  place(newestFirst, gen, cx) {
    const have = new Map(this.tiles.map((t) => [t.path, t]));
    const fresh = [];
    const tiles = [...newestFirst].reverse().map((path) => {
      if (have.has(path)) return have.get(path);
      const kind = m.isMarkdown(path) ? "markdown" : "image";
      const tile = { path, name: m.baseName(path), kind, state: kind === "image" ? "wait" : "ready", thumb: null, w: 0, h: 0 };
      fresh.push(tile);
      return tile;
    });
    for (const t of this.tiles) if (!tiles.includes(t)) tiles.push(t);
    this.tiles = tiles;
    const { machine } = m.splitAddress(props()?.terminal ?? "");
    cx.spawn((cx) =>
      m.each(fresh.filter((t) => t.kind === "image"), 4, async (t) => {
        try {
          const got = await host.thumbnail(machine, t.path);
          Object.assign(t, { thumb: got.rel, w: got.size?.w ?? 0, h: got.size?.h ?? 0, state: "ready" });
        } catch (e) {
          Object.assign(t, { state: "failed", why: host.message(e) });
        }
        if (gen === this.gen) cx.notify();
      }),
    );
  }

  // An image opens in the viewer with the gallery's images to step through; markdown in its own.
  // The mouse's side buttons, over the gallery: the image before or after the one the viewer
  // shows, or the first (forward) or last (back) when it shows none of this terminal's.
  stepTile(d, cx) {
    const images = this.tiles.filter((t) => t.kind === "image");
    const { machine } = m.splitAddress(props()?.terminal ?? "");
    const cur = S.shown && S.shown.machine === machine ? images.findIndex((t) => t.path === S.shown.path) : -1;
    const next = cur < 0 ? (d > 0 ? images[0] : images.at(-1)) : images[cur + d];
    if (next) this.openTile(this.tiles.indexOf(next), cx);
  }

  openTile(i, cx) {
    const t = this.tiles[i];
    if (!t || this.busy) return;
    const { machine } = m.splitAddress(props()?.terminal ?? "");
    const images = this.tiles.filter((x) => x.kind === "image").map((x) => x.path);
    const extra = t.kind === "image" ? { set: { paths: images, at: images.indexOf(t.path) } } : {};
    this.busy = t.path;
    cx.notify();
    cx.spawn(async (cx) => {
      await host.openFile(machine, t.path, extra).catch((e) => fail(`Couldn't open ${t.name}`, e));
      this.busy = null;
      cx.notify();
    });
  }

  galleryUi() {
    const p = props() ?? {};
    const term = terminals().find((t) => t.address === p.terminal);
    const { machine } = m.splitAddress(p.terminal ?? "");
    const from = [term?.title || term?.name || p.terminal, machine].filter(Boolean).join(" · ");
    const count = m.galleryCount(this.tiles);
    const status =
      this.phase === "screen"
        ? `${from} · looking…`
        : this.phase === "history"
          ? `${from}${count ? ` · ${count}` : ""} · looking further back…`
          : `${from} · ${count || "none"}`;
    return {
      tiles: this.tiles.map((t) => ({ ...t, busy: this.busy === t.path })),
      from: p.terminal ?? "",
      status,
      empty: this.phase === "done" ? "This terminal hasn't printed the path of an image or markdown file that's still there." : "",
      handle: this.handle,
      barHeight: host.BAR,
      act: {
        open: (i, cx) => this.openTile(i, cx),
        step: (d, cx) => this.stepTile(d, cx),
        reload: (cx) => this.loadGallery(cx),
        close: () => closeOverlay(p.overlay),
        key: (e) => e.key === "escape" && closeOverlay(p.overlay),
      },
    };
  }

  // -------------------------------------------------------------------------
  // The viewer

  flash(note, cx) {
    this.note = note;
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(2500);
      if (this.note === note) {
        this.note = null;
        cx.notify();
      }
    });
  }

  viewerActs() {
    const p = props() ?? {};
    return {
      size: (size, cx) => {
        this.body = size;
        cx.notify();
      },
      toggleFit: (cx) => {
        this.fit = !this.fit;
        cx.notify();
      },
      copy: (cx) =>
        cx.spawn(async (cx) => {
          this.flash((await host.copyImage(p.local)) ? "Copied to the clipboard" : "Couldn't copy the image", cx);
        }),
      save: (cx) =>
        cx.spawn(async (cx) => {
          try {
            this.flash(`Saved to Downloads as ${await host.saveToDownloads(p.local, p.name)}`, cx);
          } catch (e) {
            this.flash(host.message(e), cx);
          }
        }),
      copyText: (cx) => {
        cx.write_to_clipboard(p.text ?? "");
        this.flash("Copied the markdown", cx);
      },
      openApp: (cx) => cx.spawn(async (cx) => ((await host.openInApp(p.local)) ? null : this.flash("macOS couldn't open it", cx))),
      // The gallery's next or previous image, in this window's place.
      step: (d, cx) => {
        const set = p.set;
        const at = (set?.at ?? -1) + d;
        if (this.role !== "viewer" || this.stepping || !Array.isArray(set?.paths) || at < 0 || at >= set.paths.length) return;
        this.stepping = true;
        cx.spawn(async (cx) => {
          try {
            await host.openFile(p.machine ?? null, set.paths[at], { set: { ...set, at } });
          } catch (e) {
            this.flash(host.message(e), cx);
          } finally {
            this.stepping = false;
          }
        });
      },
      // Web links go to the browser; anything else (a relative link, an anchor) stays put.
      link: (url, cx) => /^https?:\/\//i.test(url ?? "") && cx.open_url(url),
      close: () => closeOverlay(p.overlay),
      key: (e, cx) => {
        if (e.key === "escape") closeOverlay(p.overlay);
        else if (e.key === "left" || e.key === "right") this.viewerActs().step(e.key === "left" ? -1 : 1, cx);
        else if (this.role === "viewer" && (e.key === "space" || e.key === "f")) {
          this.fit = !this.fit;
          cx.notify();
        }
      },
    };
  }

  // -------------------------------------------------------------------------

  render() {
    if (this.role === "watcher") return views.chip({ forwards: host.forwards(), act: { list: () => this.openList() } });
    if (this.role === "viewer") return views.viewer({ props: props() ?? {}, fit: this.fit, body: this.body, note: this.note, handle: this.handle, barHeight: host.BAR, act: this.viewerActs() });
    if (this.role === "markdown") return views.markdownViewer({ props: props() ?? {}, note: this.note, handle: this.handle, barHeight: host.BAR, act: this.viewerActs() });
    if (this.role === "gallery") return views.gallery(this.galleryUi());
    if (this.role === "menu") return views.menu({ items: this.items(), at: this.at, handle: this.handle, act: { choose: (i, cx) => this.choose(i, cx), key: (e, cx) => this.menuKey(e, cx) } });
    if (this.role === "forwards")
      return views.forwardsList({
        forwards: host.forwards().map((r) => ({ ...r, ...host.usage(r) })),
        now: Date.now(),
        handle: this.handle,
        act: {
          open: (r, cx) => cx.open_url(`http://localhost:${r.port}/`),
          stop: (r, cx) => cx.spawn(async (cx) => {
            await host.stopForward(r);
            cx.notify();
          }),
          stopAll: (cx) => cx.spawn(async (cx) => {
            await host.stopAll();
            closeOverlay(props()?.overlay);
            cx.notify();
          }),
          key: (e) => e.key === "escape" && closeOverlay(props()?.overlay),
        },
      });
    return div();
  }

  openList() {
    openOverlay({ mod: host.MOD, kind: "popup", width: 320, height: views.forwardsHeight(host.forwards().length), props: { view: "forwards" } });
  }
}

// remote-open's part in ⌘-clicks (Ctrl-clicks off macOS) on links and paths in a terminal. Herdr
// calls handleLink for the ones mod.json's link_handlers match, in the layouts whose
// "link_handlers" name this mod. model.linkTarget says which of them are ours: in another
// machine's terminal, a page on its localhost, a sign-in that redirects there, or a file
// remote-open opens here. Every other click is passed on, so this Mac's terminals keep Herdr's
// own opener.
//
// Herdr runs this without a view: no `cx`, so no timer and no `cx.open_url`. The watcher (main.js)
// has both and holds the forwards, so the click is left for it in localStorage, which Herdr
// shares between the two. In a layout without a watcher nobody takes it: after CLICK_WAIT this
// does it itself, with `open` and `sleep` run as programs.

import { exec, notify } from "herdr";
import * as m from "./model.js";
import * as host from "./host.js";

const STEP = 200;
const own = {
  open_url: (url) => exec("/usr/bin/open", [url], { timeout: 10_000 }),
  sleep: (ms) => exec("/bin/sleep", [String(ms / 1000)], { timeout: ms + 5000 }).catch(() => null),
};

// True once the watcher has the click.
async function handOver(target) {
  const id = host.queueClick(target);
  if (!id) return false;
  for (let waited = 0; waited < m.CLICK_WAIT; waited += STEP) {
    await own.sleep(STEP);
    if (!host.clickWaiting(id)) return true;
  }
  // Taken back, unless the watcher took it this very moment.
  return !host.dropClick(id);
}

export async function handleLink(click) {
  let target = null;
  try {
    target = m.linkTarget(click);
  } catch {
    target = null;
  }
  if (!target) return "pass";
  try {
    if (await handOver(target)) return "handled";
    if (target.kind === "web") await host.loadForwards(true);
    await host.openTarget(target, own);
  } catch (e) {
    notify({ title: `Couldn't open ${host.targetName(target)}`, body: host.message(e), level: "error" });
  }
  return "handled";
}

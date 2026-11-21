// The herdr module, backed by a world the test sets up. Calls that act are recorded.
export const world = {
  props: {},
  placement: null,
  window: { platform: "macos", active: true },
  layout: null,
  layoutName: "mine",
  layouts: ["main", "mine"],
  shared: {},
  settings: { zoom: 1, font_family: "JetBrains Mono" },
  panes: [],
  agents: [],
  spaces: [],
  terminals: [],
  keys: [],
  notes: [],
  checking: false,
  files: {},
  runs: [],
  overlays: [],
  closed: [],
  execs: [],
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  hcs: [],
  hc: async () => ({ code: 0, stdout: '{"address":"t1"}', stderr: "" }),
  watches: [],
  listeners: [],
  // Every copy waiting for a key gets it, as in the app.
  command(name) {
    for (const deliver of world.listeners.splice(0)) deliver(name);
  },
};

export const theme = () =>
  new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `#${[...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(6, "0").slice(0, 6)}` : undefined) });
export const settings = () => world.settings;
export const props = () => world.props;
export const placement = () => world.placement;
export const window = () => world.window;
export const machines = () => world.machines ?? [];
export const focused = () => world.focused ?? null;
export const layout = () => world.layout;
export const layouts = () => world.layouts;
export const shared = (k) => (k === "layout" ? world.layoutName : world.shared[k]);
export const setShared = (k, v) => {
  world.shared[k] = v;
  return null;
};
export const run = (name, args) => {
  world.runs.push([name, args]);
  if (name === "layout.set") world.layout = args.layout;
  if (name === "layout.clone") {
    world.layout = { ...world.layout, cloned_from: { name: args.name } };
    world.layoutName = args.as;
    world.layouts = [...world.layouts, args.as];
  }
  return null;
};
export const openOverlay = (spec) => {
  world.overlays.push(spec);
  return `o${world.overlays.length}`;
};
export const closeOverlay = (id) => {
  world.closed.push(id);
  return null;
};
export const panes = () => world.panes;
export const agents = () => world.agents;
export const spaces = () => world.spaces;
export const terminals = () => world.terminals;
export const keys = () => world.keys;
export const appHome = () => "/home/me/.config/herdr-app";
export const home = () => "/home/me";
export const readTextFile = async (p) => world.files[p] ?? null;
export const exec = (...args) => {
  world.execs.push(args);
  return world.exec(...args);
};
export const hc = (args) => {
  world.hcs.push(args);
  return world.hc(args);
};
// A watch that never fires unless the test resolves it.
export const watchFolder = (dir) => {
  if (world.refuseWatch?.()) return Promise.reject(new Error(`${dir}: No such file or directory`));
  let done;
  const p = new Promise((resolve) => (done = resolve));
  p.cancel = () => done([]);
  world.watches.push({ dir, fire: done });
  return p;
};
export const checking = () => world.checking;
export const notify = (n) => {
  world.notes.push(n);
  return `n${world.notes.length}`;
};
// Key commands for the mod: a test delivers one with world.command("toggle").
export const nextCommand = () => new Promise((resolve) => world.listeners.push(resolve));

// Maps the host's bare module names to the in-memory stubs beside this file.
import { register } from "node:module";

register(new URL("./hooks.mjs", import.meta.url));

// localStorage as the mod has it: strings under keys, shared by the watcher and link.js.
const kept = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (kept.has(k) ? kept.get(k) : null),
    setItem: (k, v) => void kept.set(k, String(v)),
    removeItem: (k) => void kept.delete(k),
    clear: () => kept.clear(),
  },
});

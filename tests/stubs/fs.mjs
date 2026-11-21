// fs/promises for the mod, over an in-memory folder tree the test can read.
export const disk = new Map();
export const dirs = new Set();
const missing = (p) => Object.assign(new Error(`${p}: No such file or directory`), { code: "ENOENT" });
export async function readFile(path, enc) {
  if (!disk.has(path)) throw missing(path);
  const v = disk.get(path);
  return enc ? (typeof v === "string" ? v : new TextDecoder().decode(v)) : typeof v === "string" ? new TextEncoder().encode(v) : v;
}
export async function writeFile(path, contents) {
  disk.set(path, contents);
}
export async function readdir(path) {
  const pre = `${path}/`;
  return [...disk.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map((k) => k.slice(pre.length));
}
export async function exists(path) {
  return disk.has(path) || dirs.has(path);
}
export async function unlink(path) {
  if (!disk.delete(path)) throw missing(path);
}
export async function rmdir(path) {
  dirs.delete(path);
}
export async function mkdir(path) {
  dirs.add(path);
}

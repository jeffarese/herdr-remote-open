const STUBS = { "gpui-kit": "gpui-kit.mjs", "gpui-base": "gpui-base.mjs", herdr: "herdr.mjs", "fs/promises": "fs.mjs", net: "net.mjs" };

export async function resolve(specifier, context, next) {
  // Only the mod's own imports are stubbed; the tests themselves use Node's real modules.
  const fromMod = context.parentURL?.includes("/mods/");
  if (STUBS[specifier] && (fromMod || !["fs/promises", "net"].includes(specifier))) return { url: new URL(`./${STUBS[specifier]}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}

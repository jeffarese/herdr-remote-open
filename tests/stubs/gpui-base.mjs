import { make } from "./gpui-kit.mjs";
export const h_flex = () => make("h_flex");
export const v_flex = () => make("v_flex");
export const TextView = { markdown: (id, text) => make("text_view", { id, text }), html: (id, html) => make("text_view", { id, html }) };

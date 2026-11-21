// What remote-open draws: the floating image viewer, the terminal right-click menu (Herdr's
// pane items plus the images the terminal printed), the forwards chip and its list. Each view
// takes a `ui` with the copy's state and its actions, so tests can draw them without Herdr.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { fit } from "./model.js";

const icon = (name) => `mods/remote-open/${name}.svg`;
const chrome = (name) => `mods/workspace-chrome/${name}.svg`;

const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

function button(t, id, name, tip, onClick, label) {
  return stop(
    h_flex()
      .id(id)
      .h(24)
      .px(label ? 8 : 5)
      .gap(5)
      .rounded(6)
      .items_center()
      .flex_none()
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .accessibility_label(tip)
      .role("button")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      }),
  )
    .when(Boolean(name), (el) => el.child(svg(icon(name)).size(14).flex_none()))
    .when(Boolean(label), (el) => el.child(div().text_size(11.5).child(label)));
}

// ---------------------------------------------------------------------------
// The viewer: a floating window with the picture and a title bar to drag it by.

export function viewer(ui) {
  const t = theme();
  const p = ui.props;
  const from = p.machine ?? "this Mac";
  const natural = p.w > 0 && p.h > 0 ? { w: p.w, h: p.h } : null;
  let pic = image(p.file);
  if (ui.fit) {
    const room = ui.body ? fit(natural?.w ?? 0, natural?.h ?? 0, ui.body.width - 16, ui.body.height - 16) : null;
    pic = room && natural ? pic.w(room.w).h(room.h) : pic.size_full();
  } else if (natural) pic = pic.w(natural.w).h(natural.h);

  const bar = h_flex()
    .id("ro-bar")
    .h(ui.barHeight)
    .flex_none()
    .w_full()
    .pl(12)
    .pr(6)
    .gap(4)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(svg(icon("image")).size(14).flex_none().text_color(t.muted))
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .items_baseline()
        .child(div().flex_shrink_0().font_semibold().whitespace_nowrap().child(p.name))
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).tooltip(p.path).child(ui.note ?? `${from}${natural ? ` · ${natural.w}×${natural.h}` : ""}`)),
    )
    .child(button(t, "ro-fit", ui.fit ? null : "fit", ui.fit ? "Actual size (1:1)" : "Fit to the window", (cx) => ui.act.toggleFit(cx), ui.fit ? "1:1" : null))
    .child(button(t, "ro-copy", "copy", "Copy image", (cx) => ui.act.copy(cx)))
    .child(button(t, "ro-save", "download", "Save to Downloads", (cx) => ui.act.save(cx)))
    .child(button(t, "ro-open", "external", "Open in its app", (cx) => ui.act.openApp(cx)))
    .child(button(t, "ro-close", "x", "Close (Esc)", (cx) => ui.act.close(cx)));

  const body = div()
    .id("ro-body")
    .flex_1()
    .min_h(0)
    .w_full()
    .bg(t.canvas ?? t.background)
    .when(!ui.fit, (el) => el.overflow_scroll())
    .on_size_change((size, cx) => ui.act.size(size, cx))
    .child(h_flex().id("ro-pic").when(ui.fit, (el) => el.size_full()).p(8).items_center().justify_center().child(pic));

  return v_flex()
    .id("ro-viewer")
    .size_full()
    .bg(t.background)
    .text_color(t.foreground)
    .text_size(12.5)
    .track_focus(ui.handle)
    .on_key_down((e, cx) => ui.act.key(e, cx))
    .child(bar)
    .child(body);
}

// ---------------------------------------------------------------------------
// The terminal menu: the pane items Herdr's own menu has, and above them the images this
// terminal printed most recently.

export const MENU_ROW = 31;

export function menu(ui) {
  const t = theme();
  const list = ui.items;
  return v_flex()
    .id("ro-menu")
    .track_focus(ui.handle)
    .w_full()
    .min_h(0)
    .p(5)
    .bg(t.popover)
    .text_size(12.8)
    .on_key_down((e, cx) => ui.act.key(e, cx))
    .children(
      list.map((it, i) =>
        v_flex()
          .when(i > 0 && it.sep, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(
            h_flex()
              .id(`mi-${i}`)
              .h(MENU_ROW)
              .px(8)
              .gap(9)
              .rounded(7)
              .items_center()
              .text_color(t.foreground)
              .when(i === ui.at, (el) => el.bg(t.selected))
              .when(it.busy, (el) => el.loop("opacity", { from: 0.45, to: 1, period: 900 }))
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => ui.act.choose(i, cx))
              .child(svg(it.image ? icon("image") : chrome(it.icon)).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().min_w(0).truncate().tooltip(it.tip ?? it.label).child(it.label))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint ?? "")),
          ),
      ),
    )
    .when(Boolean(ui.note), (el) => el.child(div().px(8).py(6).text_size(11.5).text_color(t.dim).child(ui.note)));
}

// ---------------------------------------------------------------------------
// The forwards chip (the floating block; nothing while no port is forwarded) and its list.

const left = (r, now) => {
  if (!r.until) return "until stopped";
  const min = Math.max(0, Math.ceil((r.until - now) / 60_000));
  return `sign-in, ${min} min left`;
};

export function chip(ui) {
  const list = ui.forwards;
  if (!list.length) return div().id("ro-idle");
  const t = theme();
  const label = list.length === 1 ? `:${list[0].port} ${list[0].machine}` : `${list.length} forwards`;
  return stop(
    h_flex()
      .id("ro-chip")
      .h(26)
      .px(9)
      .gap(6)
      .items_center()
      .cursor_pointer()
      .text_size(11.5)
      .text_color(t.foreground)
      .tooltip("Ports forwarded from other machines. Click to see or stop them.")
      .on_click((_e, cx) => ui.act.list(cx)),
  )
    .child(svg(icon("forward")).size(13).flex_none().text_color(t.accent))
    .child(div().whitespace_nowrap().child(label));
}

export const FORWARD_ROW = 44;

export function forwardsList(ui) {
  const t = theme();
  const now = ui.now;
  const rows = ui.forwards.map((r) =>
    h_flex()
      .id(`fw-${r.port}`)
      .h(FORWARD_ROW)
      .px(8)
      .gap(8)
      .rounded(7)
      .items_center()
      .hover((s) => s.bg(t.hover))
      .child(svg(icon("forward")).size(14).flex_none().text_color(t.accent))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().font_semibold().truncate().child(`localhost:${r.port}`))
          .child(div().text_size(11).text_color(t.dim).truncate().child(`${r.machine} · ${left(r, now)}`)),
      )
      .child(button(t, `fw-open-${r.port}`, "external", `Open http://localhost:${r.port}`, (cx) => ui.act.open(r, cx)))
      .child(button(t, `fw-stop-${r.port}`, "x", "Stop this forward", (cx) => ui.act.stop(r, cx))),
  );
  return v_flex()
    .id("ro-forwards")
    .w_full()
    .p(5)
    .bg(t.popover)
    .text_size(12.5)
    .text_color(t.foreground)
    .track_focus(ui.handle)
    .on_key_down((e, cx) => ui.act.key(e, cx))
    .child(div().px(8).pt(4).pb(6).text_size(11.5).text_color(t.dim).child(rows.length ? "Ports forwarded to this Mac" : "No ports are forwarded."))
    .children(rows)
    .when(rows.length > 1, (el) =>
      el.child(div().mx(7).my(4).h(1).bg(t.border)).child(
        h_flex()
          .id("fw-stop-all")
          .h(MENU_ROW)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => ui.act.stopAll(cx))
          .child(svg(icon("x")).size(14).flex_none().text_color(t.muted))
          .child(div().child("Stop all")),
      ),
    );
}

export const forwardsHeight = (n) => 10 + 26 + n * FORWARD_ROW + (n > 1 ? 9 + MENU_ROW : 0);

// Trace's look for the native chat (docs/trace-ui/target.md). The colors are the person's Herdr theme with T3 Code's
// recipes (a share of the foreground over the canvas); the step lines are shadcn's Trace line. Every number the rows
// share lives here, so the rows stay alike. Rows drawn inside the list take no handlers (they throw there and blank
// the list): presses go through the list's on_item_click; hover is a style only.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, window } from "herdr";

// The macOS system font (SF Pro) has real weights and italics; Herdr's Geist draws one weight only (bold and
// semibold come out regular), so it is the font everywhere else.
export const font = () => (window()?.platform === "macos" ? ".AppleSystemUIFont" : null);

// Sizes, px at zoom 1 (target.md §2-§5).
export const S = {
  text: 14, prose: 1.625, // 14 / 22.75
  line: 20, // a Trace line: 14 / 20
  meta: 12, // times, labels: 12 / 16
  lane: 736, side: 48, sideNarrow: 12, narrow: 640,
  bubbleR: 16, bubbleP: 12, bubbleMax: 0.8,
  rowR: 6, ctrlR: 8, codeR: 8, inlineR: 4,
  icon: 16, chevron: 16, gap: 8,
  ruleX: 7, nest: 16, // a step's detail: 7 + 1 px rule + 16 = the title's x (24)
  outMax: 256,
  composerR: 16, send: 32, ctrl: 28,
};

// "#rgb", "#rrggbb" or "#rrggbbaa" to [r, g, b, a 0..1]; a theme name that isn't hex comes back null.
function rgba(c) {
  const h = String(c ?? "").replace(/^#/, "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(h)) return null;
  const x = h.length === 3 ? h.split("").map((d) => d + d).join("") : h;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)).concat(x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1);
}
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

// a at share p (0..1) over b, flattened: T3's `a/p` drawn on b. A theme color with its own alpha (a border is often
// "#rrggbbaa") counts at that alpha too.
export function mix(a, b, p) {
  const x = rgba(a), y = rgba(b);
  if (!x || !y) return a;
  const s = p * x[3];
  return hex(x.map((v, i) => (i < 3 ? v * s + y[i] * (1 - s) : 1)));
}
// a with alpha p, for what lies over changing ground (hover fills, overlays).
export function alpha(a, p) {
  const x = rgba(a);
  return x ? `${hex(x)}${Math.round(Math.max(0, Math.min(1, p * x[3])) * 255).toString(16).padStart(2, "0")}` : a;
}

// The palette for this theme, worked out once per theme.
let memo = null;
export function tokens(t) {
  const dark = Boolean(settings()?.dark);
  const key = [t.background, t.foreground, t.muted, t.border, t.accent, t.hover, t.ansi1, t.working, t.done, dark].join("|");
  if (memo?.key === key) return memo.v;
  const fg = t.foreground, bg = t.background;
  const v = {
    dark,
    canvas: bg,
    fg,
    prose: mix(fg, bg, 0.9), // assistant text: foreground @90%
    muted: t.muted, // tool lines, icons, times
    soft: mix(t.muted, bg, 0.7), // a line's description: muted @70%
    hover: t.hover,
    bubble: mix(fg, bg, dark ? 0.12 : 0.08), // T3's message surface: #ebebed on #fcfcfc, #1e1e1e on #000
    border: t.border,
    rule: mix(t.border, bg, 0.6), // separators: border @60%
    codeBg: mix(fg, bg, dark ? 0.035 : 0.025), // a code block's fill
    inlineBg: mix(fg, bg, 0.1), // inline code: foreground @10%
    primary: t.accent,
    onPrimary: t.accent_foreground ?? t.solid_foreground ?? "#ffffff",
    disabled: mix(fg, bg, 0.12), // the empty send button
    composerBorder: mix(fg, bg, dark ? 0.06 : 0.09), // T3: black @8% light, white @5% dark
    composerFocus: mix(fg, bg, dark ? 0.12 : 0.16),
    danger: t.ansi1 ?? t.blocked, // errors: the theme's red
    // Agent and step status dots keep Herdr's own status colors, as the sidebar shows them (T3's are blue and green).
    working: t.working,
    done: t.done,
    blocked: t.blocked,
    claude: "#d97757",
  };
  memo = { key, v };
  return v;
}

// Each kind of step's icon (core/chat-log.js step kinds).
export const STEP_ICONS = { run: "terminal", read: "file-text", edit: "square-pen", search: "search", web: "globe", agent: "bot", plan: "list-todo", tool: "wrench" };

// A Lucide icon (mods/chat/trace-icons, ISC), tinted with the text color unless one is given.
export const icon = (name, size = S.icon, color = null) =>
  svg(`mods/chat/trace-icons/${name}.svg`).size(size).flex_none().when(Boolean(color), (el) => el.text_color(color));

// One step line (shadcn TraceLine): [icon] title [description] [chevron], 20 tall. `status`: undefined (done),
// "running" (the title pulses), "error" (all of it in the danger color), "pending" (faded). `chevron`: "right"
// (closed), "down" (open) or null. Muted, turning foreground under the pointer when it can be pressed.
export function traceLine(k, { icon: name = null, title, desc = null, status, chevron = null, press = false }) {
  const color = status === "error" ? k.danger : k.muted;
  // The chevron sits 4 px after the line (shadcn's trigger gap), in a group of its own: a negative margin would
  // collapse the line's width in Herdr.
  const line = h_flex().min_w(0).gap(S.gap).items_center()
    .when(Boolean(name), (el) => el.child(icon(name)))
    .child(div().min_w(0).truncate().child(title)
      .when(status === "running", (el) => el.loop("opacity", { from: 1, to: 0.5, period: 2000 })))
    .when(desc != null, (el) => el.child(div().flex_none().text_color(k.soft).child(String(desc))));
  return h_flex().h(S.line).max_w_full().min_w(0).gap(4).items_center().text_size(S.text).line_height(`${S.line}px`)
    .text_color(color).when(status === "pending", (el) => el.opacity(0.6))
    .when(press && status !== "error", (el) => el.cursor_pointer().hover((s) => s.text_color(k.fg)))
    .child(line)
    .when(Boolean(chevron), (el) => el.child(icon(chevron === "down" ? "chevron-down" : "chevron-right", S.chevron)));
}

// A step's detail under its line: behind a 1 px rule under the icon's middle, at the title's x.
export const traceDetail = (k, children) =>
  v_flex().ml(S.ruleX).mt(S.gap).mb(4).border_l(1).border_color(k.border).pl(S.nest).pr(4).gap(S.gap)
    .text_size(S.text).line_height(S.prose).text_color(k.muted).children(children);

// A small code block (a step's output): mono 12 / 19.5, padding 12, radius 8, at most 256 tall.
export const outputBlock = (k, text, mono = null) =>
  div().w_full().max_h(S.outMax).overflow_hidden().rounded(S.codeR).bg(k.codeBg).border_1().border_color(k.rule).p(12)
    .text_size(12).line_height("19.5px").text_color(k.fg).when(Boolean(mono), (el) => el.font_family(mono)).child(String(text ?? ""));

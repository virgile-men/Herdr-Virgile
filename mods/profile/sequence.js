// The sequence diagram, drawn natively: one lifeline per context, like the plugin's own page (view.html of
// harness-profiler 0.2.2, MIT, Copyright (c) 2026 Aleksandr Furmanov; layout ported from its
// sequenceEvents, groupInline, packColumns and drawSequence).
//
// Rows are events in time order, not to scale. A call that opens a context is a message to that context's
// lifeline (filled head; open head when it runs in the background), and its end is a dashed return with
// the result. Inline skills are diamonds on the caller's bar (three or more in a row share one), tool
// calls are self-messages ("All calls" only), and a compaction is a note on its lifeline. Contexts that
// never overlap share a column; the header then holds one chip per context. Each bar's tokens sit to the
// right of its top. Lines and arrowheads are painted paths (window.paint_path); bars, headers and labels
// are positioned divs, with the details in their tooltips.
import { div, PathBuilder } from "gpui-kit";
import { MAIN, startOf, contextOf, shortId, kindWord, hueOf, count, took, clock } from "./profile.js";

const GUTTER = 70, RIGHT = 96, COL_MIN = 210, HEAD = 50, ROW = 34, SPENT_ROW = 58, LABEL_PAD = 12;
const GROUP_MIN = 3;       // inline skills in a row that share one diamond
const MAX_EVENTS = 400;    // the last ones; older rows are dropped with a note

// The rows: [{ t, k, type: "call" | "return" | "self" | "note" | "group", … }] in time order.
function sequenceEvents(m, all) {
  const ev = [];
  m.calls.forEach((c, i) => {
    const s = startOf(c), child = c.child_agent_id;
    if (child && m.byId.has(child)) {
      ev.push({ t: s, k: 0, type: "call", i, from: contextOf(c), to: child });
      if (!c.running) ev.push({ t: s + (c.duration_ms || 0), k: 2, type: "return", i, from: child, to: contextOf(c) });
    } else if (c.tool === "Skill" || all) {
      ev.push({ t: s, k: 1, type: "self", i, at: contextOf(c) });
    }
  });
  for (const mk of m.compactions) ev.push({ t: mk.at, k: 1, type: "note", mark: mk, at: mk.ctx });
  ev.sort((a, b) => a.t - b.t || a.k - b.k);
  const isInline = (e) => e.type === "self" && m.calls[e.i].tool === "Skill";
  const out = [];
  for (let k = 0; k < ev.length;) {
    let j = k;
    while (j < ev.length && isInline(ev[j]) && ev[j].at === ev[k].at) j += 1;
    if (j - k >= GROUP_MIN) { out.push({ t: ev[k].t, type: "group", at: ev[k].at, is: ev.slice(k, j).map((e) => e.i) }); k = j; }
    else { out.push(...ev.slice(k, Math.max(j, k + 1))); k = Math.max(j, k + 1); }
  }
  return out;
}

// One column per context at a time: a context takes the first column right of its caller's whose last
// context ended before it started.
function packColumns(contexts, span) {
  const ends = [], col = new Map(), members = [];
  for (const c of contexts) {
    const [from, to] = span(c);
    let k = c.id === MAIN ? 0 : (col.get(c.parent) ?? 0) + 1;
    while (k < ends.length && ends[k] >= from) k += 1;
    ends[k] = to; col.set(c.id, k);
    (members[k] = members[k] || []).push(c);
  }
  return { col, members };
}

// Painted strokes and fills, grouped by style so each group is one native path.
class Ink {
  constructor() { this.strokes = new Map(); this.fills = new Map(); }
  line(color, width, dash, points) {
    const key = `${color}|${width}|${dash ? dash.join(",") : ""}`;
    if (!this.strokes.has(key)) this.strokes.set(key, { color, width, dash, polys: [] });
    this.strokes.get(key).polys.push(points);
  }
  fill(color, points) {
    if (!this.fills.has(color)) this.fills.set(color, []);
    this.fills.get(color).push(points);
  }
  // An arrowhead at (x, y) pointing right (dir 1) or left (-1): filled, or open (a stroked chevron).
  head(color, x, y, dir, open, width = 1.6) {
    const pts = [[x - dir * 8, y - 4.5], [x, y], [x - dir * 8, y + 4.5]];
    if (open) this.line(color, width, null, pts); else this.fill(color, pts);
  }
  elements() {
    const out = [];
    const layer = (path, color) => window.paint_path(path, color).absolute().top(0).left(0).size_full();
    for (const { color, width, dash, polys } of this.strokes.values()) {
      let b = PathBuilder.stroke(width);
      if (dash) b = b.dash_array(dash);
      for (const p of polys) { b = b.move_to(p[0][0], p[0][1]); for (const q of p.slice(1)) b = b.line_to(q[0], q[1]); }
      out.push(layer(b.build(), color));
    }
    for (const [color, polys] of this.fills) {
      let b = PathBuilder.fill();
      for (const p of polys) b = b.add_polygon(p, true);
      out.push(layer(b.build(), color));
    }
    return out;
  }
}

// The diagram as one element, `width` wide at least (the space it has), as tall as its rows.
export function sequence(t, m, { all, width }) {
  let rows = sequenceEvents(m, all);
  const dropped = Math.max(0, rows.length - MAX_EVENTS);
  if (dropped) rows = rows.slice(dropped);
  const rowOf = new Map();
  rows.forEach((e, r) => { if (e.type === "call" || e.type === "return") rowOf.set(`${e.type}${e.i}`, r); });
  const callOf = new Map(m.calls.map((c, i) => [c.child_agent_id, i]).filter(([child]) => child));
  const callRow = (c) => (c.id === MAIN ? undefined : rowOf.get(`call${callOf.get(c.id)}`));
  const returnRow = (c) => (c.id === MAIN ? undefined : rowOf.get(`return${callOf.get(c.id)}`));
  // When older rows were dropped, only main and the contexts the remaining rows mention get a column; one
  // whose call was dropped starts at the top. Otherwise every context, like the plugin's page.
  const mentioned = new Set([MAIN]);
  for (const e of rows) for (const id of [e.from, e.to, e.at]) if (id) mentioned.add(id);
  const contexts = dropped ? m.contexts.filter((c) => mentioned.has(c.id)) : m.contexts;
  const span = (c) => (c.id === MAIN ? [0, Infinity] : [callRow(c) ?? 0, returnRow(c) ?? Infinity]);
  const { col, members } = packColumns(contexts, span);
  const n = members.length;
  const colW = Math.max(COL_MIN, ((width || 900) - GUTTER - RIGHT) / n);
  const W = GUTTER + colW * n + RIGHT;
  const colX = (k) => GUTTER + colW * k + colW / 2;
  const lx = new Map(contexts.map((c) => [c.id, colX(col.get(c.id))]));
  const ys = [HEAD + 22];
  rows.forEach((e, r) => ys.push(ys[r] + (e.type === "call" && m.spend.get(e.to) ? SPENT_ROW : ROW)));
  const H = ys[rows.length] + 12;
  const ink = new Ink();
  const els = [];
  const label = (id, x, y, w, text, { color = t.foreground, size = 11.5, tip = null, bold = false } = {}) =>
    els.push(div().id(id).absolute().left(x).top(y).w(Math.max(16, w)).h(16).truncate().whitespace_nowrap()
      .text_size(size).text_color(color).when(bold, (e) => e.font_semibold()).when(Boolean(tip), (e) => e.tooltip(tip)).child(text));
  const ctxTip = (c) => {
    const kind = c.kind === "root" ? "the session itself"
      : c.kind === "copy" ? `starts with a copy of ${shortId(c.parent)}'s history`
      : c.parent ? "starts with its prompt only" : "the call that started it is not in the trace";
    const sp = m.spend.get(c.id);
    return [`${c.name ?? kindWord(c.tool)}${c.id === MAIN ? "" : ` (${kindWord(c.tool)} · ${shortId(c.id)})`}: ${kind}`,
      sp ? `${sp.calls} model call${sp.calls === 1 ? "" : "s"}, each sending the whole history again\n${count(sp.new)} new input tokens (plain input and cache writes)\n${count(sp.cached)} read from the prompt cache\n${count(sp.out)} output tokens` : ""].filter(Boolean).join("\n");
  };

  // Headers and lifelines.
  label("seq-time", 8, 18, GUTTER - 12, "time", { color: t.dim });
  members.forEach((list, k) => {
    const x = colX(k), first = list[0];
    ink.line(t.border, 1, [4, 4], [[x, HEAD], [x, H]]);
    const left = x - colW / 2 + 8, w = colW - 16;
    const hues = new Set(list.map((c) => hueOf(m, c.id)));
    if (hues.size === 1) {
      const name = first.name ?? kindWord(first.tool);
      const title = list.length === 1 ? name : `${name} ×${list.length}`;
      const sub = list.length > 1 ? `${list.length} contexts, one after another`
        : first.id === MAIN ? "main context"
        : `${kindWord(first.tool)} · ${shortId(first.id)}${first.kind === "copy" ? ` · copy of ${shortId(first.parent)}` : first.parent ? "" : " · parent not recorded"}`;
      els.push(div().id(`seq-h-${k}`).absolute().left(left).top(4).w(w).h(HEAD - 10).rounded(6).bg(hueOf(m, first.id))
        .flex().flex_col().items_center().justify_center().tooltip(list.map(ctxTip).join("\n\n"))
        .child(div().max_w(w - 12).truncate().text_size(12).font_semibold().text_color(t.background).child(title))
        .child(div().max_w(w - 12).truncate().text_size(10.5).text_color(t.background).child(sub)));
    } else {
      // Contexts of different colors took turns in this column: an outline with one chip each, in time order.
      // Past what fits (10 px a chip at least), the oldest are folded into "+N".
      const gap = 4, fit = Math.max(1, Math.floor((w - 16 + gap) / (10 + gap)));
      const folded = list.length > fit ? list.length - (fit - 1) : 0;
      const chips = folded ? list.slice(folded) : list;
      const slots = chips.length + (folded ? 1 : 0);
      const chipW = Math.max(10, (w - 16 - gap * (slots - 1)) / slots);
      els.push(div().id(`seq-h-${k}`).absolute().left(left).top(4).w(w).h(HEAD - 10).rounded(6).border_1().border_color(t.dim)
        .flex().flex_col().items_center().justify_center().gap(3)
        .child(div().flex().gap(gap)
          .when(folded > 0, (x) => x.child(div().w(chipW).h(16).flex_none().text_size(10).text_color(t.dim).truncate().child(`+${folded}`)))
          .children(chips.map((c, i) => {
          const repeat = i > 0 && (c.name ?? "") === (chips[i - 1].name ?? "");
          return div().id(`seq-chip-${k}-${i}`).w(chipW).h(16).flex_none().rounded(3).bg(hueOf(m, c.id)).px(4).truncate()
            .text_size(10.5).text_color(t.background).tooltip(ctxTip(c)).child(repeat || chipW < 24 ? "" : (c.name ?? kindWord(c.tool)));
        })))
        .child(div().text_size(10.5).text_color(t.dim).child(`${list.length} contexts, one after another`)));
    }
  });

  // Activation bars: a context is at work from the call that starts it to its return. Its tokens sit to
  // the right of the bar's top.
  for (const c of contexts) {
    const x = lx.get(c.id), cr = callRow(c), rr = returnRow(c);
    const y0 = cr !== undefined ? ys[cr] : HEAD + 4;
    const y1 = rr !== undefined ? ys[rr] : cr !== undefined ? ys[rows.length] : H - 6;
    els.push(div().id(`seq-bar-${c.id}`).absolute().left(x - 5).top(y0).w(10).h(Math.max(4, y1 - y0)).rounded(2)
      .bg(`${hueOf(m, c.id)}d9`).tooltip(ctxTip(c)));
    const sp = m.spend.get(c.id);
    if (sp) [["new", sp.new], ["cached", sp.cached], ["out", sp.out]].forEach(([word, v], j) =>
      els.push(div().id(`seq-sp-${c.id}-${j}`).absolute().left(x + 10).top(y0 + 2 + j * 13).h(13).flex().gap(4).items_center()
        .tooltip(ctxTip(c))
        .child(div().w(40).text_right().text_size(11).text_color(t.foreground).child(count(v)))
        .child(div().text_size(10.5).text_color(t.dim).child(word))));
  }

  // The rows.
  const busy = (o, r) => o.id === MAIN || ((callRow(o) ?? -1) < r && r < (returnRow(o) ?? rows.length));
  const roomRight = (x) => (x + 26 > W - colW ? W - x - 30 : colW - 34);
  rows.forEach((e, r) => {
    const y = ys[r];
    label(`seq-t-${r}`, 8, y - 8, GUTTER - 12, clock(e.type === "note" ? e.mark.at : e.t), { color: t.dim, size: 11 });
    if (e.type === "note") {
      const x = lx.get(e.at);
      els.push(div().id(`seq-n-${r}`).absolute().left(x + 10).top(y - 11).w(Math.min(colW - 20, 170)).h(22).px(6)
        .flex().items_center().border_1().border_color(t.foreground).bg(t.background).text_size(11.5).truncate()
        .child(`compacted (${e.mark.trigger || "?"})`));
      return;
    }
    if (e.type === "group") {
      const x = lx.get(e.at) + 5, names = e.is.map((i) => m.calls[i].name || "skill");
      ink.fill(hueOf(m, e.at), [[x + 12, y - 7], [x + 19, y], [x + 12, y + 7], [x + 5, y]]);
      label(`seq-g-${r}`, x + 26, y - 8, roomRight(x), `${e.is.length} skills: ${names.join(", ")}`,
        { tip: `${e.is.length} skills loaded inline, ${clock(startOf(m.calls[e.is[0]]))} to ${clock(startOf(m.calls[e.is.at(-1)]))}:\n${names.join("\n")}` });
      return;
    }
    const c = m.calls[e.i];
    const tip = [`${c.name || kindWord(c.tool)} (${kindWord(c.tool)}) · ${clock(startOf(c))} · ${c.running ? "running" : took(c.duration_ms || 0)}${c.ok === false ? " · failed" : ""}`,
      c.args && c.args !== c.name ? `Arguments: ${c.args}` : "", c.result ? `Result: ${c.result}` : ""].filter(Boolean).join("\n");
    if (e.type === "self") {
      const x = lx.get(e.at) + 5, inline = c.tool === "Skill";
      if (inline) ink.fill(hueOf(m, e.at), [[x + 12, y - 7], [x + 19, y], [x + 12, y + 7], [x + 5, y]]);
      else { ink.line(t.muted, 1, null, [[x, y - 6], [x + 18, y - 6], [x + 18, y + 6], [x + 4, y + 6]]); ink.head(t.muted, x + 2, y + 6, -1, false); }
      label(`seq-s-${r}`, x + 26, y - 8, roomRight(x), `${c.name || kindWord(c.tool)} (${kindWord(c.tool)})`,
        { color: c.ok === false ? t.ansi1 : t.foreground, tip });
      return;
    }
    // A call or its return, between two lifelines.
    const right = lx.get(e.to) > lx.get(e.from), dir = right ? 1 : -1;
    const x0 = lx.get(e.from) + dir * 5, x1 = lx.get(e.to) - dir * 5;
    const child = m.byId.get(c.child_agent_id);
    const isCall = e.type === "call";
    if (isCall) { ink.line(hueOf(m, contextOf(c)), 2, null, [[x0, y], [x1 - dir * (c.background ? 0 : 6), y]]); ink.head(hueOf(m, c.child_agent_id), x1, y, dir, Boolean(c.background), 1.8); }
    else { ink.line(t.muted, 1.5, [5, 4], [[x0, y], [x1, y]]); ink.head(t.muted, x1, y, dir, true, 1.5); }
    // Labels start a fixed distance right of the left end and stop before the first busy bar in the way.
    const lx0 = Math.min(x0, x1) + LABEL_PAD;
    let end = Math.max(x0, x1) - 10;
    for (const o of contexts) {
      const ox = lx.get(o.id);
      if (busy(o, r) && ox > lx0 && ox - 10 < end) end = ox - 10;
    }
    const args = c.args && c.args !== c.name ? ` · ${c.args}` : "";
    const text = isCall ? `${c.name || kindWord(c.tool)} (${kindWord(c.tool)})${args}` : `${c.result || "done"} · ${took(c.duration_ms || 0)}`;
    label(`seq-m-${r}`, lx0, y - 19, end - lx0, text, { color: isCall ? t.foreground : c.ok === false ? t.ansi1 : t.muted, tip });
    if (isCall && (child?.kind === "copy" || c.background))
      label(`seq-x-${r}`, lx0, y + 3, end - lx0,
        [child?.kind === "copy" && "starts with a copy of this history", c.background && (c.running ? "still running in the background" : "runs in the background")].filter(Boolean).join(", "),
        { color: t.dim, size: 10.5 });
  });

  return div().relative().w(W).h(H).flex_none()
    .children(ink.elements())
    .children(els)
    .when(dropped > 0, (x) => x.child(div().absolute().left(8).top(H - 16).text_size(10.5).text_color(t.dim)
      .child(`${dropped} older rows not shown`)));
}

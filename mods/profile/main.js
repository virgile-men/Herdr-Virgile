// Profile: the harness-profiler trace of the session the Session panel follows (the active terminal, or
// the agent of a chat pane), as a popup (dialog) opened from Session's Profile section. Two views:
//   Tree      one row per skill or agent call (per tool call too with "All calls", like
//             `hp tree --verbose`): start, duration, bar, the tokens of the context it opened (new,
//             cached, out). Clicking a row unfolds its arguments and result.
//   Sequence  the sequence diagram, drawn natively (sequence.js): one lifeline per context.
// "Open in browser ↗" opens the plugin's own page. Commands (keys.json, or `herdr-app do profile.<command>`
// while the popup is shown): profile.tree, profile.sequence, profile.all (toggles "All calls"),
// profile.section (collapses or expands Session's Profile section).
//
// Reading and the model live in profile.js, shared with Session. Recording stays the job of the
// harness-profiler Claude Code plugin, on each machine.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay, shared, setShared, nextCommand } from "herdr";
import { cible, session, affiche } from "./claude.js";
import { Profile, flatten, describe, bullet, hueOf, bar, share, count, took, clock, summary, failureRows } from "./profile.js";
import { sequence } from "./sequence.js";

const ID = "profile";
const ALL = "profile.all";     // "All calls" (persisted)
const VIEW = "profile.view";   // "tree" | "sequence" (persisted; Session's links set it before opening)
const MAX_ROWS = 600;          // tree rows at most (the last ones)

export default class ProfileView extends View {
  init(_props, cx) {
    this.addr = null;
    this.P = new Profile();
    this.sessionError = null;
    this.note = null;
    this.open = new Set();
    this.lastSession = 0;
    this.width = 0;
    this.follow(cx);
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "tree" || c === "sequence") setShared(VIEW, c);
        else if (c === "all") setShared(ALL, shared(ALL) !== true);
        else if (c === "section") setShared("profile.collapsed", (shared("profile.collapsed") ?? true) !== true);
        cx.notify();
      }
    });
  }

  follow(cx) {
    const a = cible();
    if (!a || a === this.addr) return;
    this.addr = a; this.sessionError = null; this.note = null; this.open.clear();
    this.P.target(null); this.lastSession = 0;
    this.tick(cx);
  }

  // The session is resolved every 10 s (a /clear changes it); the trace is read when due.
  tick(cx) {
    if (!affiche(ID) || this.busy || !this.addr) return;
    const now = Date.now();
    const resolve = now - this.lastSession >= 10000;
    if (!resolve && !this.P.due(now)) return;
    const addr = this.addr;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        if (resolve) {
          this.lastSession = Date.now();
          const s = await session(addr);
          if (this.addr !== addr) return;
          if (s.erreur) { this.sessionError = "No Claude Code session in this terminal."; this.P.target(null); return; }
          this.sessionError = null;
          this.P.target(s);
        }
        await this.P.read();
      } catch (e) {
        if (this.addr === addr) this.P.error = String(e).slice(0, 200);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  openInBrowser(cx) {
    this.note = "Rendering the page…";
    cx.spawn(async (cx) => {
      const e = await this.P.openInBrowser().catch((x) => String(x));
      this.note = e ? `Browser page: ${e}` : "Opened in the browser.";
      cx.notify();
    });
    cx.notify();
  }

  treeRows(t, m, all) {
    const rows = flatten(m, all);
    const first = Math.max(0, rows.length - MAX_ROWS);
    const shown = rows.slice(first);
    const longest = Math.max(0, ...shown.map(([n]) => (n.record && !n.record.running && n.record.duration_ms) || 0));
    const col = (w, text, color, right = true) => div().w(w).flex_none().text_size(12).text_color(color ?? t.muted)
      .when(right, (e) => e.text_right()).truncate().child(text);
    const row = ([n, depth], i) => {
      const d = describe(m, n), r = n.record, key = r?.tool_use_id ?? `${first + i}`;
      const open = this.open.has(key) && Boolean(r);
      const sp = d.sp;
      const kind = d.inline ? "inline skill" : r?.child_agent_id ? `${d.kind} · ${d.where}` : d.kind;
      const result = r && (r.child_agent_id || r.ok === false) && r.result ? `→ ${r.result}` : "";
      const args = r?.args && r.args !== r.name ? r.args : "";
      return v_flex().flex_none()
        .child(h_flex().id(`pp-${first + i}`).h(24).flex_none().mx(6).px(8).gap(8).items_center().rounded(6)
          .when(Boolean(r), (e) => e.cursor_pointer().on_click((_e, cx) => {
            if (this.open.has(key)) this.open.delete(key); else this.open.add(key);
            cx.notify();
          }))
          .hover((s) => s.bg(t.hover)).when(open, (e) => e.bg(t.selected))
          .child(col(58, n.marker ? clock(n.marker.at) : clock(n.start), t.dim, false))
          .child(col(52, r ? (r.running ? "running" : took(r.duration_ms || 0)) : ""))
          .child(r ? bar(t, hueOf(m, d.ctx), r.running ? 0 : share(r.duration_ms || 0, longest), 48) : div().w(48).flex_none())
          .child(col(42, sp ? count(sp.new) : "", t.muted))
          .child(col(46, sp ? count(sp.cached) : "", t.dim))
          .child(col(40, sp ? count(sp.out) : "", t.muted))
          .child(div().w(10).flex_none())
          .child(div().w(Math.min(depth, 10) * 14).flex_none())
          .child(bullet(t, m, n, d))
          .child(div().flex_none().max_w(260).truncate().text_size(12.5)
            .text_color(r?.ok === false ? t.ansi1 : n.marker ? t.dim : t.foreground).child(d.name))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(r?.ok === false ? `${kind} · failed` : kind))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
            .child([args && `(${args})`, result].filter(Boolean).join(" "))))
        .when(open, (e) => e.child(v_flex().flex_none().mx(14).mb(6).ml(Math.min(depth, 10) * 14 + 300).p(8).gap(4).rounded(6)
          .border_1().border_color(t.border).text_size(12)
          .children(d.info.split("\n").map((l, k) => div().id(`pp-${first + i}-d${k}`).text_color(k ? t.muted : t.foreground).child(l)))));
    };
    return [
      h_flex().flex_none().mx(6).mt(6).px(8).h(22).gap(8).items_center().border_b_1().border_color(t.border)
        .child(col(58, "start", t.dim, false)).child(col(52, "duration", t.dim)).child(div().w(48).flex_none())
        .child(col(42, "new", t.dim)).child(col(46, "cached", t.dim)).child(col(40, "out", t.dim))
        .child(div().w(10).flex_none()).child(div().flex_1().text_size(12).text_color(t.dim).child("call")),
      div().flex_1().min_h(0).relative()
        .child(v_flex().id("profile-list").absolute().inset_0().overflow_y_scroll().py(4)
          .when(first > 0, (x) => x.child(div().mx(14).py(4).text_size(11).text_color(t.dim).child(`${first} older rows not shown`)))
          .children(shown.map(row))
          .when(!shown.length, (x) => x.child(div().mx(14).py(6).text_size(12).text_color(t.dim).child("No skill or agent calls. “All calls” shows the rest."))))
        .child(Scrollbar.vertical("profile-list").absolute().inset_0()),
    ];
  }

  render(cx) {
    this.follow(cx);
    const t = theme(), P = this.P, S = P.session;
    const overlay = Boolean(props()?.overlay);
    const all = shared(ALL) === true;
    const view = shared(VIEW) === "sequence" ? "sequence" : "tree";
    const link = (id, text, action) => div().id(id).text_size(11.5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx)).child(text);
    const tab = (id, text, value) => div().id(id).h(22).px(10).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
      .text_color(view === value ? t.foreground : t.muted).when(view === value, (e) => e.bg(t.background).border_1().border_color(t.border))
      .on_click((_e, cx) => { setShared(VIEW, value); cx.notify(); }).child(text);
    const empty = this.sessionError ?? (S ? P.empty() : this.addr ? "Reading the session…" : "Select a Claude Code terminal.");
    const m = empty ? null : P.model();
    const legend = view === "sequence"
      ? "Rows in time order, not to scale · ▶ call that opens a context (open head: background) · dashed: return · ◆ inline skill · bar: context at work, with its tokens"
      : "◆ inline skill · ■ new context (same hue: copy of the caller) · ⟲ compaction · tokens: those of the context opened";

    return v_flex().id("profile").size_full().min_h(0).when(overlay, (e) => e.h(720)).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Header: title, session, view switch, "All calls", browser page, Esc.
      .child(h_flex().flex_none().px(14).pt(12).pb(8).gap(12).items_center()
        .child(div().flex_none().font_semibold().child("Profile"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child(S ? `${S.machine ?? "this Mac"} · session ${String(S.id).slice(0, 8)}${P.root ? ` · ${P.root}` : ""}` : ""))
        .child(h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.raised)
          .child(tab("view-tree", "Tree", "tree")).child(tab("view-sequence", "Sequence", "sequence")))
        .child(h_flex().id("all").gap(6).items_center().cursor_pointer().on_click((_e, cx) => { setShared(ALL, !all); cx.notify(); })
          .tooltip("Also show tool calls (Bash, Read, Edit…), like hp tree --verbose")
          .child(div().w(24).h(14).rounded(7).p(2).flex().items_center().bg(all ? t.accent : t.raised).when(all, (e) => e.justify_end())
            .child(div().size(10).rounded(5).bg(all ? t.accent_foreground : t.muted)))
          .child(div().text_size(11.5).text_color(t.muted).child("All calls")))
        .when(Boolean(m), (e) => e.child(link("browser", "Open in browser ↗", (cx) => this.openInBrowser(cx))))
        .when(overlay, (e) => e.child(link("close", "Esc", () => closeOverlay(props().overlay)))))
      .when(Boolean(empty), (el) => el.child(div().px(14).py(10).text_size(12).text_color(P.error ? t.ansi1 : t.dim).child(empty)).child(div().flex_1()))
      .when(Boolean(m), (el) => el
        .child(div().flex_none().px(14).pb(8).text_size(12).text_color(t.muted).child(summary(m.stats)))
        .children(failureRows(t, m))
        .when(view === "tree", (x) => x.children(this.treeRows(t, m, all)))
        .when(view === "sequence", (x) => x
          .child(div().id("seq-area").flex_1().min_h(0).mt(6).relative().border_t_1().border_color(t.border)
            .on_size_change((size, cx) => { if (Math.abs((this.width || 0) - size.width) > 1) { this.width = size.width; cx.notify(); } })
            .child(div().id("seq-scroll").absolute().inset_0().overflow_scroll()
              .child(sequence(t, m, { all, width: this.width })))
            .child(Scrollbar.new("seq-scroll").absolute().inset_0()))))
      .child(h_flex().flex_none().px(14).py(6).gap(8).items_center().border_t_1().border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.note ?? legend)));
  }
}

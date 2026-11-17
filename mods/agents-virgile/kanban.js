// The agents kanban (English UI since 2026-11-16, like the rest of the mod since 2026-11-17):
// one column per state, Idle first on the left (then Needs you, Working, Done), and one card per agent
// with everything known about it: where it runs (machine, space, tab, folder, branch), since when, and
// for Claude Code its session read from its log (title, model, effort, context, cost, prompts,
// compactions, last prompt, last reply, progress), its sub-agents and its tab's labels. Cards show at
// once; the session arrives when the read on its machine is done (every 20 s, while the view is open).
// Each agent's own CPU, memory and network (its process tree): every 5 s. The per-machine band that used
// to sit on top was removed (2026-11-16, asked): Session › Resources still shows the agent's machine.
// Two card looks (shared "agents-virgile.kanban.compact", Detailed / Compact button or the C key):
// detailed (all of the above, with Open, Peek and Pin buttons) or compact (three lines: who and its
// state, where, and its numbers; the rest in the tooltip; click: open, right-click: peek).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, run, terminals } from "herdr";
import * as A from "./arbre.js";
import { data, icon, chrome, allAgents, openArgs, programIcon, statusMark, tabLabels, machineOf, isCompact, setCompact } from "./etat.js";
import { readSessions, nomModele } from "./session.js";
// Copy of ~/herdr-panneaux/panneaux/_commun/ressources.js (copy it again when it changes).
import { Mesures, mesurer } from "./ressources.js";

const COLUMNS = [
  { status: "idle", label: "Idle" },
  { status: "blocked", label: "Needs you" },
  { status: "working", label: "Working" },
  { status: "done", label: "Done" },
];
const REFRESH = 20000;
const WORD = { blocked: "needs you", working: "working", done: "done", idle: "idle" };

// English formats for this view (the same ones as the shared modules use).
const fmt = {
  dur: (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "<1m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  },
  tokens: (n) => (!isFinite(n) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n))),
  usd: (x) => (x == null || !isFinite(x) ? "—" : `$${x < 10 ? x.toFixed(2) : x.toFixed(1)}`),
  pct: (x) => (x == null || !isFinite(x) ? "—" : `${x >= 10 ? Math.round(x) : x.toFixed(1)}%`),
  bytes: (n) => (n == null || !isFinite(n) ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${Math.round(n)} B`),
  rate: (n) => (n == null || !isFinite(n) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB/s` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} KB/s` : `${Math.round(n)} B/s`),
};
const pending = (x, f) => (x == null ? "…" : f(x));
// An agent's three numbers on one line: "CPU 12% · RAM 488 MB · ↓ 3.1 KB/s ↑ 0.4 KB/s".
const resLine = (v) => `CPU ${pending(v.cpu, fmt.pct)} · RAM ${fmt.bytes(v.rss)} · ↓ ${pending(v.rx, fmt.rate)} ↑ ${pending(v.tx, fmt.rate)}`;
// Its tooltip: processes, machine, and how it is measured.
const resDetail = (v) => {
  const m = v.machine;
  return [
    `${v.nproc} process${v.nproc === 1 ? "" : "es"} (the agent and what it started)`,
    "CPU: 100% = one full core",
    m ? `Machine: ${m.cpus} core${m.cpus > 1 ? "s" : ""}, RAM ${fmt.bytes(m.total - m.dispo)} used of ${fmt.bytes(m.total)} (${fmt.pct((1 - m.dispo / (m.total || 1)) * 100)})` : null,
    m?.os === "linux" ? "Network: TCP connections still open (a low estimate)" : "Network: the process's own bytes (nettop)",
  ].filter(Boolean).join("\n");
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const isClaude = (k) => Boolean(k?.foreground?.pid) && /claude/i.test(`${k.program?.key ?? ""} ${k.report?.app ?? ""} ${(k.foreground.argv ?? []).join(" ")}`);
// Text on one line, without Markdown, cut at n characters.
const plain = (s, n) => {
  const x = String(s ?? "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};
const ago = (now, at) => (at ? `${fmt.dur(now - at)} ago` : "—");
const MODES = { auto: "auto", plan: "plan", default: "default", acceptEdits: "accept edits", bypassPermissions: "bypass permissions", dontAsk: "don't ask" };
const tabName = (a) => (/^\d+$/.test(a.tab_name ?? "") ? `tab ${a.tab_name}` : a.tab_name);

export class KanbanView {
  init(cx) {
    this.p = props() ?? {};
    this.sessions = {}; // address -> session details | { error } | { none }
    this.loading = false;
    this.readAt = 0;
    this.filter = null; // null: all; "none": no group; else a root group
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.mesures = new Mesures();
    this.res = {}; // address -> ressources.js mesurer().agents
    this.load(cx);
    this.measure(cx);
    cx.timer.every(REFRESH, (cx) => this.load(cx));
    cx.timer.every(5000, (cx) => this.measure(cx));
    cx.timer.every(30000, (cx) => cx.notify());
  }

  close() {}

  load(cx) {
    if (this.loading) return;
    const ts = terminals();
    const list = allAgents().map((a) => ts.find((k) => k.address === a.address)).filter(isClaude)
      .map((k) => ({ address: k.address, pid: k.foreground.pid }));
    if (!list.length) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.sessions = { ...this.sessions, ...(await readSessions(list, this.sessions)) };
        this.readAt = Date.now();
      } catch (e) {
        this.err = String(e).slice(0, 200);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // Each agent's CPU, memory and network: its program (or its shell), and what it started.
  measure(cx) {
    if (this.measuring) return;
    const ts = terminals();
    const list = allAgents().map((a) => ts.find((k) => k.address === a.address)).filter((k) => k && (k.foreground?.pid || k.pid))
      .map((k) => ({ cle: k.address, pid: k.foreground?.pid || k.pid, machine: machineOf(k.address) }));
    if (!list.length) return;
    this.measuring = true;
    cx.spawn(async (cx) => {
      try {
        const r = await mesurer(this.mesures, list);
        this.res = { ...this.res, ...r.agents };
        this.mesures.oublie(new Set(list.map((a) => a.cle)));
      } finally {
        this.measuring = false;
        cx.notify();
      }
    });
  }

  // An info line: a grey icon, then the text.
  line(t, name, text, { tone, mono, title } = {}) {
    return h_flex().gap(7).items_center().min_w(0).text_size(11.5)
      .when(Boolean(title), (el) => el.tooltip(title))
      .child(svg(name).size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_color(tone ?? t.muted).when(Boolean(mono), (el) => el.font_family("JetBrains Mono").text_size(11)).child(text));
  }

  chip(t, text, color, ic = null) {
    return h_flex().h(20).px(7).gap(5).flex_none().items_center().rounded(10).bg(`${color}22`).text_size(10.5).text_color(t.foreground)
      .when(Boolean(ic), (el) => el.child(svg(ic).size(11).text_color(color)))
      .when(!ic, (el) => el.child(div().size(7).rounded(4).bg(color)))
      .child(div().max_w(150).truncate().child(text));
  }

  bar(t, value, color) {
    const v = Math.max(0, Math.min(1, value || 0));
    return div().h(5).flex_1().rounded(3).bg(t.hover).child(div().h_full().rounded(3).bg(color).w(`${Math.round(v * 1000) / 10}%`));
  }

  // A quoted block of text (last prompt, last reply).
  quote(t, label, text) {
    return v_flex().gap(3).flex_none()
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(div().px(8).py(6).rounded(7).bg(t.raised).text_size(11.5).text_color(t.foreground).line_height("16px").child(text));
  }

  card(t, a, k, now, d) {
    if (isCompact()) return this.small(t, a, k, now, d);
    const s = this.sessions[a.address];
    const m = machineOf(a.address);
    const addr = a.address.split("/").pop();
    const gid = A.groupOfAgent(d, a.address);
    const tab = tabName(a);
    const name = this.nameOf(a, s);
    const since = k?.status_ms ? now - k.status_ms : null;
    const folder = k?.foreground?.cwd ?? k?.cwd ?? s?.cwd ?? "";
    const branch = s?.branch && s.branch !== "HEAD" ? s.branch : null;
    const kids = terminals().filter((x) => x.parent === a.address && x.state === "live");
    const labels = a.tab ? tabLabels(a.tab) : [];
    const claude = isClaude(k);
    const on = this.p.focus === a.address || a.focused;
    const body = [];

    // Header: program, name (the session's title), pin, state and since when.
    body.push(h_flex().gap(8).items_center().min_w(0)
      .child(programIcon(a.program, 16, t.foreground) ?? div().size(16))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(name))
      .when(a.pinned, (el) => el.child(svg(icon("pin")).size(12).flex_none().text_color(t.dim)))
      .child(statusMark(t, a.status, true)));
    body.push(h_flex().gap(6).items_center().min_w(0).text_size(11).text_color(t.dim)
      .child(div().flex_none().text_color(t[a.status] ?? t.dim).child(WORD[a.status] ?? a.status))
      .when(since != null, (el) => el.child(div().flex_none().child(`for ${fmt.dur(since)}`)))
      .when(Boolean(k?.turn), (el) => el.child(div().flex_none().child(`· turn ${k.turn}`)))
      .when(a.settled, (el) => el.child(h_flex().flex_none().gap(3).items_center().child(svg(icon("archive")).size(11)).child("settled")))
      .child(div().flex_1())
      .when(Boolean(gid), (el) => el.child(this.chip(t, d.groups[gid].name, A.colorOf(d, gid), icon(d.groups[gid].icon)))));

    // Where it runs.
    body.push(this.line(t, icon(m ? "server" : "monitor"), `${m ?? ""} · ${addr}`, { title: m ? `${m} · ${addr}` : `This computer · ${addr}` }));
    if (a.space_name || tab) body.push(this.line(t, icon("layers"), [a.space_name, tab].filter(Boolean).join(" › ") + (a.chat ? " · chat" : "") + (a.pane ? "" : " · no pane")));
    if (folder) body.push(this.line(t, icon("folder"), folder, { title: folder }));
    if (branch) body.push(this.line(t, icon("git-branch"), branch));
    if (k?.created_ms) body.push(this.line(t, icon("clock-3"), `terminal opened ${ago(now, k.created_ms)}`));
    const res = this.res[a.address];
    if (res?.erreur) body.push(this.line(t, icon("activity"), `Resources unreadable: ${res.erreur}`, { tone: t.dim, title: res.erreur }));
    else if (res) body.push(this.line(t, icon("activity"), resLine(res), { tone: t.foreground, title: resDetail(res) }));
    else body.push(this.line(t, icon("activity"), "Measuring resources…", { tone: t.dim }));

    // The Claude Code session.
    if (claude && !s) body.push(this.line(t, chrome("spinner"), "Reading the session…", { tone: t.dim }));
    else if (s?.error) body.push(this.line(t, chrome("x"), `Session unreadable: ${s.error}`, { tone: t.blocked, title: s.error }));
    else if (s?.none) body.push(this.line(t, icon("hash"), "No Claude Code session found", { tone: t.dim }));
    else if (s && !s.answers) {
      body.push(div().h(1).my(2).bg(t.border));
      body.push(this.line(t, icon("cpu"), ["No exchange in this session yet", s.version ? `v${s.version}` : null].filter(Boolean).join(" · "), { tone: t.dim }));
      if (s.id) body.push(this.line(t, icon("hash"), s.id, { mono: true, title: s.file || "no log yet" }));
    } else if (s) {
      body.push(div().h(1).my(2).bg(t.border));
      const model = s.last?.model ? nomModele(s.last.model) : "—";
      body.push(this.line(t, icon("cpu"), [model, s.last?.effort ? `effort ${s.last.effort}` : null, s.version ? `v${s.version}` : null].filter(Boolean).join(" · ")));
      if (s.mode) body.push(this.line(t, icon("shield-check"), `mode ${MODES[s.mode] ?? s.mode}`));
      if (s.context != null) {
        const share = s.context / (s.window || 1e6);
        const color = share > 0.8 ? t.blocked : share > 0.5 ? t.done : t.accent;
        body.push(h_flex().gap(7).items_center().text_size(11.5)
          .child(svg(icon("gauge")).size(12).flex_none().text_color(t.dim))
          .child(this.bar(t, share, color))
          .child(div().flex_none().text_color(t.muted).child(`${fmt.tokens(s.context)} / ${fmt.tokens(s.window)} · ${Math.round(share * 100)}%`)));
      }
      body.push(this.line(t, icon("coins"), [`${s.costKnown ? "" : "≈ "}${fmt.usd(s.cost)}`, plural(s.asks ?? 0, "prompt"), `${s.answers ?? 0} repl${(s.answers ?? 0) === 1 ? "y" : "ies"}`, s.compactions ? plural(s.compactions, "compaction") : null].filter(Boolean).join(" · "),
        { title: s.models.map((x) => `${nomModele(x.model)}: ${fmt.tokens(x.u.input_tokens)} input, ${fmt.tokens(x.u.cache_read_input_tokens)} cache reads, ${fmt.tokens(x.u.cache_creation_input_tokens)} cache writes, ${fmt.tokens(x.u.output_tokens)} output`).join("\n") || "No reply" }));
      body.push(this.line(t, icon("history"), `session started ${ago(now, s.first)} · active ${ago(now, s.at)}`));
      body.push(this.line(t, icon("hash"), s.id, { mono: true, title: s.file }));
      if (s.progress?.total) {
        body.push(h_flex().gap(7).items_center().text_size(11.5)
          .child(svg(icon("list-checks")).size(12).flex_none().text_color(t.dim))
          .child(this.bar(t, (s.progress.done ?? 0) / s.progress.total, t.working))
          .child(div().flex_none().text_color(t.muted).child(`${s.progress.done ?? 0}/${s.progress.total}`)));
        if (s.progress.note) body.push(div().pl(19).text_size(11).text_color(t.dim).truncate().child(s.progress.note));
      }
      if (s.prompt) body.push(this.quote(t, "Last prompt", plain(s.prompt, 220)));
      if (s.answer) body.push(this.quote(t, "Last reply", plain(s.answer, 320)));
    } else if (!claude && a.title) body.push(this.line(t, icon("message-square-text"), a.title));

    // Its sub-agents, and its tab's labels.
    if (kids.length) {
      body.push(div().text_size(10.5).text_color(t.dim).pt(2).child(`Sub-agents (${kids.length})`));
      for (const x of kids.slice(0, 6)) body.push(h_flex().gap(6).items_center().pl(4).text_size(11.5).min_w(0)
        .child(svg(icon("corner-down-right")).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(x.name || x.template || x.title || x.program?.name || x.address))
        .child(statusMark(t, x.status === "error" ? "blocked" : x.status === "done" ? "idle" : x.status ?? "idle", true)));
    }
    if (labels.length) body.push(h_flex().gap(4).flex_wrap().children(labels.map((l) => this.chip(t, l.name, l.color))));

    // The actions.
    const act = (id, text, ic, f) => h_flex().id(id).h(24).px(8).gap(5).items_center().rounded(6).flex_none().cursor_pointer()
      .text_size(11).text_color(t.muted).border_1().border_color(t.border)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); f(); })
      .child(svg(ic).size(11)).child(text);
    body.push(h_flex().gap(6).pt(2)
      .child(act(`kb-open-${a.address}`, "Open", chrome("terminal"), () => { closeOverlay(this.p.overlay); run(...openArgs(a)); }))
      .child(act(`kb-peek-${a.address}`, "Peek", icon("eye"), () => { closeOverlay(this.p.overlay); run("terminal.peek", { terminal: a.address }); }))
      .child(act(`kb-pin-${a.address}`, a.pinned ? "Unpin" : "Pin", icon(a.pinned ? "pin-off" : "pin"), () => run("terminal.pin", { terminal: a.address, pinned: !a.pinned }))));

    return v_flex().id(`kb-${a.address}`).flex_none().p(12).gap(6).rounded(10).bg(t.background)
      .border_1().border_color(on ? t.accent : t.border)
      .hover((el) => el.border_color(on ? t.accent : t.input))
      .children(body);
  }

  // A card's name: the session's title, else a named tab, the terminal's title, the program.
  nameOf(a, s) {
    return s?.title || (a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : "") || a.title || a.program?.name || a.address.split("/").pop();
  }

  // A compact card: who and its state; where (machine › space › tab) and since when; its numbers
  // (context, cost, progress, CPU and RAM, sub-agents). Everything else in the tooltip.
  small(t, a, k, now, d) {
    const s = this.sessions[a.address];
    const m = machineOf(a.address);
    const addr = a.address.split("/").pop();
    const gid = A.groupOfAgent(d, a.address);
    const tab = tabName(a);
    const name = this.nameOf(a, s);
    const since = k?.status_ms ? now - k.status_ms : null;
    const res = this.res[a.address];
    const kids = terminals().filter((x) => x.parent === a.address && x.state === "live").length;
    const on = this.p.focus === a.address || a.focused;
    const share = s?.context != null ? s.context / (s.window || 1e6) : null;

    // The numbers: a grey icon and a value each.
    const fig = (ic, text, color = t.muted) => h_flex().flex_none().gap(3).items_center()
      .child(svg(icon(ic)).size(11).text_color(t.dim)).child(div().text_color(color).child(text));
    const figs = [];
    if (share != null) figs.push(fig("gauge", `${Math.round(share * 100)}%`, share > 0.8 ? t.blocked : share > 0.5 ? t.done : t.muted));
    if (s?.cost) figs.push(fig("coins", `${s.costKnown ? "" : "≈ "}${fmt.usd(s.cost)}`));
    if (s?.progress?.total) figs.push(fig("list-checks", `${s.progress.done ?? 0}/${s.progress.total}`));
    if (res && !res.erreur) figs.push(fig("activity", `${pending(res.cpu, fmt.pct)} · ${fmt.bytes(res.rss)}`));
    if (kids) figs.push(fig("corner-down-right", String(kids)));

    // The tooltip: what the detailed card shows, as text.
    const folder = k?.foreground?.cwd ?? k?.cwd ?? s?.cwd ?? "";
    const branch = s?.branch && s.branch !== "HEAD" ? s.branch : null;
    const tip = [
      `${name} · ${WORD[a.status] ?? a.status}${since != null ? ` for ${fmt.dur(since)}` : ""}${k?.turn ? ` · turn ${k.turn}` : ""}${a.settled ? " · tab settled" : ""}`,
      `${m ?? "This computer"} · ${addr}${a.space_name || tab ? ` · ${[a.space_name, tab].filter(Boolean).join(" › ")}` : ""}${a.chat ? " · chat" : ""}${a.pane ? "" : " · no pane"}`,
      gid ? `Group: ${d.groups[gid].name}` : null,
      folder || null,
      branch ? `Branch: ${branch}` : null,
      s?.last?.model ? [nomModele(s.last.model), s.last.effort ? `effort ${s.last.effort}` : null, s.mode ? `mode ${MODES[s.mode] ?? s.mode}` : null].filter(Boolean).join(" · ") : null,
      share != null ? `Context ${fmt.tokens(s.context)} / ${fmt.tokens(s.window)} · ${s.costKnown ? "" : "≈ "}${fmt.usd(s.cost)} · ${plural(s.asks ?? 0, "prompt")}` : null,
      res && !res.erreur ? resLine(res) : res?.erreur ? `Resources unreadable: ${res.erreur}` : null,
      s?.progress?.note ? `Progress: ${s.progress.note}` : null,
      s?.prompt ? `Last prompt: ${plain(s.prompt, 160)}` : null,
      s?.answer ? `Last reply: ${plain(s.answer, 200)}` : null,
      "Click: open · right-click: peek at the terminal",
    ].filter(Boolean).join("\n");

    const close = () => closeOverlay(this.p.overlay);
    return v_flex().id(`kb-${a.address}`).flex_none().px(10).py(8).gap(4).rounded(9).bg(t.background).cursor_pointer()
      .border_1().border_color(on ? t.accent : t.border)
      .hover((el) => el.border_color(on ? t.accent : t.input))
      .tooltip(tip)
      .on_click(() => { close(); run(...openArgs(a)); })
      .on_mouse_down("right", () => { close(); run("terminal.peek", { terminal: a.address }); })
      .child(h_flex().gap(7).items_center().min_w(0)
        .child(programIcon(a.program, 14, t.foreground) ?? div().size(14))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
        .when(a.pinned, (el) => el.child(svg(icon("pin")).size(11).flex_none().text_color(t.dim)))
        .when(Boolean(gid), (el) => el.child(div().size(7).flex_none().rounded(4).bg(gid ? A.colorOf(d, gid) : t.dim)))
        .child(statusMark(t, a.status, true)))
      .child(h_flex().gap(5).items_center().min_w(0).text_size(11).text_color(t.dim)
        .child(svg(icon(m ? "server" : "monitor")).size(11).flex_none())
        .child(div().flex_1().min_w(0).truncate().child([m, a.space_name !== m ? a.space_name : null, tab].filter(Boolean).join(" › ") || addr))
        .when(a.settled, (el) => el.child(svg(icon("archive")).size(11).flex_none()))
        .when(since != null, (el) => el.child(div().flex_none().child(fmt.dur(since)))))
      .when(figs.length > 0, (el) => el.child(h_flex().gap(9).items_center().min_w(0).overflow_hidden().text_size(11).children(figs)));
  }

  render() {
    const t = theme();
    const d = data();
    const now = Date.now();
    const ts = terminals();
    let list = allAgents();
    const roots = d.children.root.map(A.unref).filter((x) => x.kind === "g" && d.groups[x.id]).map((x) => x.id);
    if (this.filter && this.filter !== "none" && !d.groups[this.filter]) this.filter = null;
    if (this.filter === "none") { const inside = new Set(roots.flatMap((g) => A.agentsIn(d, g))); list = list.filter((a) => !inside.has(a.address)); }
    else if (this.filter) { const inside = new Set(A.agentsIn(d, this.filter)); list = list.filter((a) => inside.has(a.address)); }
    const close = () => closeOverlay(this.p.overlay);
    const compact = isCompact();
    // Detailed / Compact: two buttons side by side; the C key toggles too.
    const seg = (id, text, ic, active, v) => h_flex().id(id).h(22).px(8).gap(5).items_center().rounded(6).cursor_pointer()
      .text_size(11.5).text_color(active ? t.foreground : t.muted).when(active, (el) => el.bg(t.selected))
      .hover((el) => el.bg(active ? t.selected : t.hover))
      .tooltip("C key: toggle")
      .on_click((_e, cx) => { setCompact(v); cx.notify(); })
      .child(svg(icon(ic)).size(12)).child(text);
    const machinesShown = new Set(list.map((a) => machineOf(a.address) ?? ""));

    const filterChip = (id, text, active, f, color = null, ic = null) => h_flex().id(id).h(24).px(9).gap(5).items_center().rounded(12).flex_none().cursor_pointer()
      .text_size(11.5).border_1().border_color(active ? t.accent : t.border).bg(active ? t.selected : "#00000000")
      .text_color(active ? t.foreground : t.muted).hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => { f(); cx.notify(); })
      .when(Boolean(ic), (el) => el.child(svg(ic).size(12).text_color(color ?? t.muted)))
      .child(text);

    const column = (c) => {
      const mine = list.filter((a) => a.status === c.status);
      return v_flex().id(`kb-col-${c.status}`).flex_1().min_w(0).h_full().min_h(0).rounded(12).bg(t.chrome).border_1().border_color(t.border)
        .child(h_flex().h(38).px(12).gap(8).flex_none().items_center()
          .child(statusMark(t, c.status, true))
          .child(div().text_size(12.5).font_semibold().text_color(t[c.status] ?? t.foreground).child(c.label))
          .child(div().text_size(11.5).text_color(t.dim).child(String(mine.length))))
        .child(v_flex().id(`kb-list-${c.status}`).flex_1().min_h(0).px(8).pb(8).gap(compact ? 6 : 8).overflow_y_scrollbar()
          .children(mine.length
            ? mine.map((a) => this.card(t, a, ts.find((k) => k.address === a.address), now, d))
            : [div().px(6).py(10).text_size(11.5).text_color(t.dim).child("No agents")]));
    };

    // Herdr draws the dialog's frame (6 px rounded border) without clipping its content: the background is rounded to 5 px.
    return v_flex().id("av-kanban").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).rounded(5).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { close(); cx.stop_propagation(); }
        else if (e.keystroke === "c") { setCompact(!compact); cx.notify(); cx.stop_propagation(); }
      })
      .child(h_flex().flex_none().gap(10).items_center()
        .child(svg(icon("square-kanban")).size(18).text_color(t.muted))
        .child(div().text_size(15).font_semibold().child("Agents"))
        .child(div().text_size(12).text_color(t.dim).child(`${plural(list.length, "agent")} · ${plural(machinesShown.size, "machine")}`))
        .child(div().flex_1())
        .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
          .child(seg("kb-v-full", "Detailed", "layout-grid", !compact, false))
          .child(seg("kb-v-compact", "Compact", "rows-3", compact, true)))
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "Reading sessions…" : this.readAt ? `Sessions read ${ago(now, this.readAt)}` : ""))
        .child(div().id("kb-refresh").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .tooltip("Read the sessions again").hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => this.load(cx))
          .child(svg(icon("refresh-cw")).size(14).text_color(t.muted)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(roots.length > 0, (el) => el.child(h_flex().flex_none().gap(6).flex_wrap()
        .child(filterChip("kb-f-all", "All", !this.filter, () => { this.filter = null; }))
        .children(roots.map((g) => filterChip(`kb-f-${g}`, d.groups[g].name, this.filter === g, () => { this.filter = g; }, A.colorOf(d, g), icon(d.groups[g].icon))))
        .child(filterChip("kb-f-none", "No group", this.filter === "none", () => { this.filter = "none"; }))))
      .child(h_flex().flex_1().min_h(0).gap(12).children(COLUMNS.map(column)));
  }
}

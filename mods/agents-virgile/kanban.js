// La vue kanban des agents : une colonne par état (vous attend, en cours, terminé, au repos), une
// carte par agent avec tout ce qu'on sait de lui : où il est (machine, space, onglet, dossier,
// branche), depuis quand, et pour Claude Code sa session lue dans son journal (titre, modèle, effort,
// contexte, coût, demandes, compactages, dernière demande, dernière réponse, progression), ses
// sous-agents et les étiquettes de son onglet. Les cartes s'affichent tout de suite ; la session
// arrive quand la lecture sur sa machine est faite (toutes les 20 s, tant que la vue est ouverte).
// Ce que chaque agent consomme (CPU, mémoire, réseau de son arbre de processus) et ce que consomme
// chacune de leurs machines entière (une bande en haut) : toutes les 5 s.
// Deux vues des cartes (shared "agents-virgile.kanban.compact", bouton Détaillé / Compact ou touche C) :
// détaillée (tout ce qui précède, avec les boutons Ouvrir, Aperçu, Épingler) ou compacte (trois lignes :
// qui et son état, où, et ses chiffres ; le reste dans l'infobulle ; clic : ouvrir, clic droit : aperçu).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, run, terminals, focused } from "herdr";
import * as A from "./arbre.js";
import { data, icon, chrome, allAgents, openArgs, programIcon, statusMark, tabLabels, machineOf, isCompact, setCompact } from "./etat.js";
import { readSessions, nomModele, tokens, dollars, dureeCourte } from "./session.js";
// Copie de ~/herdr-panneaux/panneaux/_commun/ressources.js (à recopier quand elle change).
import { Mesures, mesurer, resume, detail, pourcent, octets, debit, detailMachine } from "./ressources.js";

const COLUMNS = [
  { status: "blocked", label: "Vous attend" },
  { status: "working", label: "En cours" },
  { status: "done", label: "Terminé" },
  { status: "idle", label: "Au repos" },
];
const REFRESH = 20000;
const WORD = { blocked: "vous attend", working: "en cours", done: "terminé", idle: "au repos" };

const isClaude = (k) => Boolean(k?.foreground?.pid) && /claude/i.test(`${k.program?.key ?? ""} ${k.report?.app ?? ""} ${(k.foreground.argv ?? []).join(" ")}`);
// Un texte en une ligne, sans la mise en forme Markdown, coupé à n caractères.
const plain = (s, n) => {
  const x = String(s ?? "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};
const ago = (now, at) => (at ? `il y a ${dureeCourte(now - at)}` : "—");
const MODES = { auto: "auto", plan: "plan", default: "normal", acceptEdits: "modifs acceptées", bypassPermissions: "sans permissions", dontAsk: "sans demander" };

export class KanbanView {
  init(cx) {
    this.p = props() ?? {};
    this.sessions = {}; // adresse -> détails de session | { error } | { none }
    this.loading = false;
    this.readAt = 0;
    this.filter = null; // null : tous ; "none" : sans groupe ; sinon un groupe racine
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.mesures = new Mesures();
    this.res = {}; // adresse -> ressources.js mesurer().agents
    this.resM = {}; // machine ("" : celle-ci) -> mesurer().machines
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

  // CPU, mémoire et réseau de chaque agent : son programme (ou son shell), et ce qu'il a lancé.
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
        this.resM = { ...this.resM, ...r.machines };
        this.mesures.oublie(new Set(list.map((a) => a.cle)));
      } finally {
        this.measuring = false;
        cx.notify();
      }
    });
  }

  // Une machine en pastille : son nom (rien pour cet ordinateur : l'icône suffit), CPU, RAM et réseau.
  machineChip(t, m) {
    const v = this.resM[m];
    const nom = m || "";
    const part = (x) => (x == null ? "…" : x);
    const txt = !v ? "mesure…" : v.erreur ? "injoignable"
      : `CPU ${part(v.cpu == null ? null : pourcent(v.cpu))} · RAM ${octets(v.utilisee).replace(/ Go$/, "")}/${octets(v.total)} · ↓${part(v.rx == null ? null : debit(v.rx))} ↑${part(v.tx == null ? null : debit(v.tx))}`;
    const hot = v && !v.erreur && ((v.cpu ?? 0) > 80 || v.utilisee / (v.total || 1) > 0.9);
    return h_flex().id(`kb-m-${m || "local"}`).h(24).px(9).gap(6).items_center().rounded(12).flex_none()
      .border_1().border_color(hot ? t.blocked : t.border).text_size(11.5).text_color(t.muted)
      .tooltip(`${m || "Cet ordinateur"}\n${v ? (v.erreur ?? detailMachine(v)) : "mesure en cours"}`)
      .child(svg(icon(m ? "server" : "monitor")).size(12).text_color(t.dim))
      .when(Boolean(nom), (el) => el.child(div().text_color(t.foreground).child(nom)))
      .child(div().child(txt));
  }

  // Une ligne d'information : une icône grise, puis le texte.
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

  // Un bloc de texte cité (dernière demande, dernière réponse).
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
    const tab = /^\d+$/.test(a.tab_name ?? "") ? `onglet ${a.tab_name}` : a.tab_name;
    const name = this.nameOf(a, s);
    const since = k?.status_ms ? now - k.status_ms : null;
    const folder = k?.foreground?.cwd ?? k?.cwd ?? s?.cwd ?? "";
    const branch = s?.branch && s.branch !== "HEAD" ? s.branch : null;
    const kids = terminals().filter((x) => x.parent === a.address && x.state === "live");
    const labels = a.tab ? tabLabels(a.tab) : [];
    const claude = isClaude(k);
    const on = this.p.focus === a.address || a.focused;
    const body = [];

    // En-tête : programme, nom (le titre de la session), épingle, état et depuis quand.
    body.push(h_flex().gap(8).items_center().min_w(0)
      .child(programIcon(a.program, 16, t.foreground) ?? div().size(16))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(name))
      .when(a.pinned, (el) => el.child(svg(icon("pin")).size(12).flex_none().text_color(t.dim)))
      .child(statusMark(t, a.status, true)));
    body.push(h_flex().gap(6).items_center().min_w(0).text_size(11).text_color(t.dim)
      .child(div().flex_none().text_color(t[a.status] ?? t.dim).child(WORD[a.status] ?? a.status))
      .when(since != null, (el) => el.child(div().flex_none().child(`depuis ${dureeCourte(since)}`)))
      .when(Boolean(k?.turn), (el) => el.child(div().flex_none().child(`· tour ${k.turn}`)))
      .when(a.settled, (el) => el.child(h_flex().flex_none().gap(3).items_center().child(svg(icon("archive")).size(11)).child("rangé")))
      .child(div().flex_1())
      .when(Boolean(gid), (el) => el.child(this.chip(t, d.groups[gid].name, A.colorOf(d, gid), icon(d.groups[gid].icon)))));

    // Où il est.
    body.push(this.line(t, icon(m ? "server" : "monitor"), `${m ?? ""} · ${addr}`, { title: m ? `${m} · ${addr}` : `Cet ordinateur · ${addr}` }));
    if (a.space_name || tab) body.push(this.line(t, icon("layers"), [a.space_name, tab].filter(Boolean).join(" › ") + (a.chat ? " · chat" : "") + (a.pane ? "" : " · sans volet")));
    if (folder) body.push(this.line(t, icon("folder"), folder, { title: folder }));
    if (branch) body.push(this.line(t, icon("git-branch"), branch));
    if (k?.created_ms) body.push(this.line(t, icon("clock-3"), `terminal ouvert ${ago(now, k.created_ms)}`));
    const res = this.res[a.address];
    if (res?.erreur) body.push(this.line(t, icon("activity"), `Ressources illisibles : ${res.erreur}`, { tone: t.dim, title: res.erreur }));
    else if (res) body.push(this.line(t, icon("activity"), resume(res), { tone: t.foreground, title: detail(res) }));
    else body.push(this.line(t, icon("activity"), "Mesure des ressources…", { tone: t.dim }));

    // La session Claude Code.
    if (claude && !s) body.push(this.line(t, chrome("spinner"), "Lecture de la session…", { tone: t.dim }));
    else if (s?.error) body.push(this.line(t, chrome("x"), `Session illisible : ${s.error}`, { tone: t.blocked, title: s.error }));
    else if (s?.none) body.push(this.line(t, icon("hash"), "Pas de session Claude Code trouvée", { tone: t.dim }));
    else if (s && !s.answers) {
      body.push(div().h(1).my(2).bg(t.border));
      body.push(this.line(t, icon("cpu"), ["Session sans échange pour l'instant", s.version ? `v${s.version}` : null].filter(Boolean).join(" · "), { tone: t.dim }));
      if (s.id) body.push(this.line(t, icon("hash"), s.id, { mono: true, title: s.file || "pas encore de journal" }));
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
          .child(div().flex_none().text_color(t.muted).child(`${tokens(s.context)} / ${tokens(s.window)} · ${Math.round(share * 100)} %`)));
      }
      body.push(this.line(t, icon("coins"), [`${s.costKnown ? "" : "≈ "}${dollars(s.cost)}`, `${s.asks ?? 0} demande${(s.asks ?? 0) > 1 ? "s" : ""}`, `${s.answers ?? 0} réponses`, s.compactions ? `${s.compactions} compactage${s.compactions > 1 ? "s" : ""}` : null].filter(Boolean).join(" · "),
        { title: s.models.map((x) => `${nomModele(x.model)} : ${tokens(x.u.input_tokens)} entrée, ${tokens(x.u.cache_read_input_tokens)} lus, ${tokens(x.u.cache_creation_input_tokens)} écrits, ${tokens(x.u.output_tokens)} sortie`).join("\n") || "Aucune réponse" }));
      body.push(this.line(t, icon("history"), `session commencée ${ago(now, s.first)} · active ${ago(now, s.at)}`));
      body.push(this.line(t, icon("hash"), s.id, { mono: true, title: s.file }));
      if (s.progress?.total) {
        body.push(h_flex().gap(7).items_center().text_size(11.5)
          .child(svg(icon("list-checks")).size(12).flex_none().text_color(t.dim))
          .child(this.bar(t, (s.progress.done ?? 0) / s.progress.total, t.working))
          .child(div().flex_none().text_color(t.muted).child(`${s.progress.done ?? 0}/${s.progress.total}`)));
        if (s.progress.note) body.push(div().pl(19).text_size(11).text_color(t.dim).truncate().child(s.progress.note));
      }
      if (s.prompt) body.push(this.quote(t, "Dernière demande", plain(s.prompt, 220)));
      if (s.answer) body.push(this.quote(t, "Dernière réponse", plain(s.answer, 320)));
    } else if (!claude && a.title) body.push(this.line(t, icon("message-square-text"), a.title));

    // Ses sous-agents, et les étiquettes de son onglet.
    if (kids.length) {
      body.push(div().text_size(10.5).text_color(t.dim).pt(2).child(`Sous-agents (${kids.length})`));
      for (const x of kids.slice(0, 6)) body.push(h_flex().gap(6).items_center().pl(4).text_size(11.5).min_w(0)
        .child(svg(icon("corner-down-right")).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(x.name || x.template || x.title || x.program?.name || x.address))
        .child(statusMark(t, x.status === "error" ? "blocked" : x.status === "done" ? "idle" : x.status ?? "idle", true)));
    }
    if (labels.length) body.push(h_flex().gap(4).flex_wrap().children(labels.map((l) => this.chip(t, l.name, l.color))));

    // Les actions.
    const act = (id, text, ic, f) => h_flex().id(id).h(24).px(8).gap(5).items_center().rounded(6).flex_none().cursor_pointer()
      .text_size(11).text_color(t.muted).border_1().border_color(t.border)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); f(); })
      .child(svg(ic).size(11)).child(text);
    body.push(h_flex().gap(6).pt(2)
      .child(act(`kb-open-${a.address}`, "Ouvrir", chrome("terminal"), () => { closeOverlay(this.p.overlay); run(...openArgs(a)); }))
      .child(act(`kb-peek-${a.address}`, "Aperçu", icon("eye"), () => { closeOverlay(this.p.overlay); run("terminal.peek", { terminal: a.address }); }))
      .child(act(`kb-pin-${a.address}`, a.pinned ? "Désépingler" : "Épingler", icon(a.pinned ? "pin-off" : "pin"), () => run("terminal.pin", { terminal: a.address, pinned: !a.pinned }))));

    return v_flex().id(`kb-${a.address}`).flex_none().p(12).gap(6).rounded(10).bg(t.background)
      .border_1().border_color(on ? t.accent : t.border)
      .hover((el) => el.border_color(on ? t.accent : t.input))
      .children(body);
  }

  // Le nom d'une carte : le titre de la session, sinon un onglet nommé, le titre du terminal, le programme.
  nameOf(a, s) {
    return s?.title || (a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : "") || a.title || a.program?.name || a.address.split("/").pop();
  }

  // Une carte compacte : qui et son état ; où (machine › space › onglet) et depuis quand ; ses chiffres
  // (contexte, coût, progression, CPU et RAM, sous-agents). Tout le reste dans l'infobulle.
  small(t, a, k, now, d) {
    const s = this.sessions[a.address];
    const m = machineOf(a.address);
    const addr = a.address.split("/").pop();
    const gid = A.groupOfAgent(d, a.address);
    const tab = /^\d+$/.test(a.tab_name ?? "") ? `onglet ${a.tab_name}` : a.tab_name;
    const name = this.nameOf(a, s);
    const since = k?.status_ms ? now - k.status_ms : null;
    const res = this.res[a.address];
    const kids = terminals().filter((x) => x.parent === a.address && x.state === "live").length;
    const on = this.p.focus === a.address || a.focused;
    const share = s?.context != null ? s.context / (s.window || 1e6) : null;

    // Les chiffres : une icône grise et une valeur chacun.
    const fig = (ic, text, color = t.muted) => h_flex().flex_none().gap(3).items_center()
      .child(svg(icon(ic)).size(11).text_color(t.dim)).child(div().text_color(color).child(text));
    const figs = [];
    if (share != null) figs.push(fig("gauge", `${Math.round(share * 100)} %`, share > 0.8 ? t.blocked : share > 0.5 ? t.done : t.muted));
    if (s?.cost) figs.push(fig("coins", `${s.costKnown ? "" : "≈ "}${dollars(s.cost)}`));
    if (s?.progress?.total) figs.push(fig("list-checks", `${s.progress.done ?? 0}/${s.progress.total}`));
    if (res && !res.erreur) figs.push(fig("activity", `${res.cpu == null ? "…" : pourcent(res.cpu)} · ${octets(res.rss)}`));
    if (kids) figs.push(fig("corner-down-right", String(kids)));

    // L'infobulle : ce que la carte détaillée montre, en texte.
    const folder = k?.foreground?.cwd ?? k?.cwd ?? s?.cwd ?? "";
    const branch = s?.branch && s.branch !== "HEAD" ? s.branch : null;
    const tip = [
      `${name} · ${WORD[a.status] ?? a.status}${since != null ? ` depuis ${dureeCourte(since)}` : ""}${k?.turn ? ` · tour ${k.turn}` : ""}${a.settled ? " · onglet rangé" : ""}`,
      `${m ?? "Cet ordinateur"} · ${addr}${a.space_name || tab ? ` · ${[a.space_name, tab].filter(Boolean).join(" › ")}` : ""}${a.chat ? " · chat" : ""}${a.pane ? "" : " · sans volet"}`,
      gid ? `Groupe : ${d.groups[gid].name}` : null,
      folder || null,
      branch ? `Branche : ${branch}` : null,
      s?.last?.model ? [nomModele(s.last.model), s.last.effort ? `effort ${s.last.effort}` : null, s.mode ? `mode ${MODES[s.mode] ?? s.mode}` : null].filter(Boolean).join(" · ") : null,
      share != null ? `Contexte ${tokens(s.context)} / ${tokens(s.window)} · ${s.costKnown ? "" : "≈ "}${dollars(s.cost)} · ${s.asks ?? 0} demande${(s.asks ?? 0) > 1 ? "s" : ""}` : null,
      res && !res.erreur ? `${resume(res)}` : res?.erreur ? `Ressources illisibles : ${res.erreur}` : null,
      s?.progress?.note ? `Progression : ${s.progress.note}` : null,
      s?.prompt ? `Dernière demande : ${plain(s.prompt, 160)}` : null,
      s?.answer ? `Dernière réponse : ${plain(s.answer, 200)}` : null,
      "Clic : ouvrir · clic droit : aperçu du terminal",
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
        .when(since != null, (el) => el.child(div().flex_none().child(dureeCourte(since)))))
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
    // Détaillé / Compact : deux boutons accolés ; la touche C bascule aussi.
    const seg = (id, text, ic, active, v) => h_flex().id(id).h(22).px(8).gap(5).items_center().rounded(6).cursor_pointer()
      .text_size(11.5).text_color(active ? t.foreground : t.muted).when(active, (el) => el.bg(t.selected))
      .hover((el) => el.bg(active ? t.selected : t.hover))
      .tooltip("Touche C : basculer")
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
            : [div().px(6).py(10).text_size(11.5).text_color(t.dim).child("Aucun agent")]));
    };

    return v_flex().id("av-kanban").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { close(); cx.stop_propagation(); }
        else if (e.keystroke === "c") { setCompact(!compact); cx.notify(); cx.stop_propagation(); }
      })
      .child(h_flex().flex_none().gap(10).items_center()
        .child(svg(icon("square-kanban")).size(18).text_color(t.muted))
        .child(div().text_size(15).font_semibold().child("Agents"))
        .child(div().text_size(12).text_color(t.dim).child(`${list.length} agent${list.length > 1 ? "s" : ""} · ${machinesShown.size} machine${machinesShown.size > 1 ? "s" : ""}`))
        .child(div().flex_1())
        .child(h_flex().flex_none().p(2).gap(2).rounded(8).border_1().border_color(t.border)
          .child(seg("kb-v-full", "Détaillé", "layout-grid", !compact, false))
          .child(seg("kb-v-compact", "Compact", "rows-3", compact, true)))
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "Lecture des sessions…" : this.readAt ? `Sessions lues ${ago(now, this.readAt)}` : ""))
        .child(div().id("kb-refresh").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .tooltip("Relire les sessions").hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => this.load(cx))
          .child(svg(icon("refresh-cw")).size(14).text_color(t.muted)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(roots.length > 0, (el) => el.child(h_flex().flex_none().gap(6).flex_wrap()
        .child(filterChip("kb-f-all", "Tous", !this.filter, () => { this.filter = null; }))
        .children(roots.map((g) => filterChip(`kb-f-${g}`, d.groups[g].name, this.filter === g, () => { this.filter = g; }, A.colorOf(d, g), icon(d.groups[g].icon))))
        .child(filterChip("kb-f-none", "Sans groupe", this.filter === "none", () => { this.filter = "none"; }))))
      .when(machinesShown.size > 0, (el) => el.child(h_flex().flex_none().gap(6).flex_wrap()
        .children([...machinesShown].sort((x, y) => (x === "" ? -1 : y === "" ? 1 : x.localeCompare(y))).map((m) => this.machineChip(t, m)))))
      .child(h_flex().flex_1().min_h(0).gap(12).children(COLUMNS.map(column)));
  }
}

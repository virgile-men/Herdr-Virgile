// Agents de Herdr-Virgile : le mod livré `agents` (0.1.12, cloné le 2026-11-15), avec en plus
//   - tous les agents, y compris ceux d'un volet de chat (Trace), qu'agents() ne liste pas ;
//   - des groupes d'agents, en haut de la liste, imbricables sur 8 niveaux, avec nom, icône et une
//     couleur que les sous-groupes héritent de leur groupe racine (le modèle de spaces-virgile,
//     arbre.js, rangé dans shared("agents-virgile")). Les agents hors groupe suivent le tri choisi ;
//   - la section collée en bas de la barre : elle prend la hauteur de sa liste (au plus la moitié de
//     la colonne) et redimensionne son bloc `agents` elle-même (layout.resize) ;
//   - dans l'en-tête : la vue kanban (kanban.js), l'icône de tri du mod livré et le menu ☰.
// Glisser : un agent sur un groupe l'y range, entre deux agents d'un groupe l'y place, sur un agent
// hors groupe, un titre de section ou l'en-tête l'en sort ; un groupe sur un autre s'y imbrique (au
// milieu de la ligne) ou se range à côté (en haut ou en bas). Clic droit : les menus (vues.js).
// Du mod livré : priorité ou par space, épingles, sous-agents repliables, rail étroit.
// Repliée en entier (clic sur « Agents », le menu ☰ ou `herdr-app do agents-virgile.replier`) : seul
// l'en-tête reste, avec le compte des agents par état ; le bloc se réduit à sa hauteur. Le rail étroit
// n'a pas d'en-tête : il ignore ce repli.
// Rangés : les agents d'un onglet rangé (tab.settle de Herdr : mis de côté sur cet écran, il tourne
// toujours) quittent les groupes et les sections pour une section « Rangés » en bas, repliée par défaut,
// du plus récemment rangé au plus ancien. On range au clic droit (« Ranger son onglet ») ou en lâchant
// un agent sur l'en-tête Rangés ; on l'en sort au clic droit, en le glissant ailleurs, ou en l'ouvrant
// (un onglet affiché revient, comme un onglet dont un agent vous attend). Option du menu ☰ : ranger tout
// seul un onglet dont les agents sont au repos depuis N jours (jamais celui affiché, ni un épinglé).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, machines, run, theme, shared, setShared, setAgentOrder, props, window, layout, nextCommand } from "herdr";
import * as A from "./arbre.js";
import { data, save, openView, listHeight, above, icon, chrome, allAgents, openArgs, RANK, kidStatus, sortOf, duration, programIcon, statusMark, isFolded, setFolded, isCompact, setCompact, headerMenuHeight, agentMenuHeight, rangesOpen, setRangesOpen, autoDays, settleArgs } from "./etat.js";
import { VIEWS } from "./vues.js";
import { KanbanView } from "./kanban.js";

const ALL_VIEWS = { ...VIEWS, kanban: KanbanView };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
const STATUS_OF = { 4: "blocked", 3: "done", 2: "working", 1: "idle" };
const WORDS = { blocked: "vous attend", working: "en cours", done: "terminé", idle: "au repos" };

// Le bloc de la disposition que cette liste remplit, et ce qu'elle se donne de hauteur.
const BLOCK = "agents";
const HEAD = 41; // l'en-tête « Agents »
const FOOT = 8; // le bas de la liste
const ROW = 30, SUB = 26, SECTION_H = 30, GROUP_H = 26, RAIL = 26, RAIL_FOOT = 28, EMPTY_H = 64;
// Rangés : collé en bas, sous la liste qui défile (comme Settled dans T3 Code) ; déplié, au plus cette
// hauteur de lignes, qui défilent à leur tour.
const RANGES_MAX = 5 * ROW;
const SHARE = 0.5; // au plus cette part de la colonne Spaces + Agents
const FALLBACK_MAX = 420; // tant que la hauteur des Spaces n'est pas connue
// Un agent fermé n'est oublié de ses groupes qu'après ce délai d'absence de sa machine lisible.
const FORGET_AFTER = 15000;

const sameAim = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.id ?? null) === (b?.id ?? null) && (a?.pos ?? null) === (b?.pos ?? null);

export default class Agents extends View {
  init(_props, cx) {
    // En overlay (menus, dialogues, kanban) : une vue de vues.js ou kanban.js, rien de la barre.
    const view = props()?.view ?? (props()?.sortMenu ? "sort" : null);
    if (view) {
      this.sub = new ALL_VIEWS[view]();
      this.sub.init(cx);
      return;
    }
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed.v2") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    this.pressed = null; // { kind: "a" | "g", id } : ce qu'on tient
    this.over = null; // { kind: "a" | "g" | "h", id, pos } : où ça tomberait
    this.missing = {}; // adresse -> depuis quand son terminal n'est plus là
    this.prunedAt = 0;
    // Les onglets sortis des rangés, et quand : le rangement automatique compte ses N jours à partir de là.
    try { this.sortis = JSON.parse(localStorage.getItem("ranges.sortis") ?? "{}"); } catch { this.sortis = {}; }
    this.prevSettled = null;
    this.autoAt = 0;
    this.byAddrAll = new Map(); // toutes les adresses d'agents, rangés compris (pour le glisser)
    this.want = null; // la hauteur que la liste demande à son bloc
    this.ownH = null; // la hauteur qu'elle a
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(250, (cx) => this.tick(cx));
    // `herdr-app do agents-virgile.<vue>` : ouvre une vue (pour essayer), sur le premier agent et groupe.
    // `replier` replie ou déplie toute la liste (sans overlay ; on peut aussi le mettre sur une touche).
    // `kanban-compact` bascule les cartes du kanban entre détaillées et compactes.
    // `ranges` déplie ou replie la section Rangés.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          const a = allAgents()[0]?.address;
          const g = data().children.root.map(A.unref)[0]?.id;
          const at = { x: 40, y: 300 };
          if (c === "replier") setFolded(!isFolded());
          else if (c === "kanban-compact") setCompact(!isCompact());
          else if (c === "ranges") setRangesOpen(!rangesOpen());
          else if (c === "kanban") openView("kanban", {});
          else if (c === "menu-agent" && a) openView("menu", { of: "agent", id: a }, at, agentMenuHeight(false));
          else if (c === "menu-group" && g) openView("menu", { of: "group", id: g }, at, listHeight(5, 0, 1));
          else if (c === "menu-header") openView("menu", { of: "header" }, at, headerMenuHeight());
          else if (c === "sort") openView("sort", {}, at, listHeight(2, 1));
          else if (c === "move" && a) openView("move", { agent: a }, at);
          else if (c === "group") openView("group", g ? { id: g } : {});
          else if (c === "new-group") openView("group", a ? { withAgent: a } : {});
        } catch (e) {
          console.log("agents-virgile", c, String(e));
        }
        cx.notify();
      }
    });
  }

  close() {
    this.sub?.close?.();
  }

  tick(cx) {
    const now = Date.now();
    if (now - this.prunedAt > 5000) { this.prunedAt = now; this.forget(now); }
    if (now - this.autoAt > 60000) { this.autoAt = now; try { this.autoSettle(now); } catch (e) { console.log("agents-virgile auto", String(e)); } }
    this.fit();
  }

  // Donne au bloc la hauteur de la liste (« collée en bas » : les Spaces prennent le reste).
  fit() {
    if (this.want == null) return;
    const block = find(layout(), BLOCK);
    if (!block) return;
    const cur = block.size?.px;
    if (cur != null && Math.abs(cur - this.want) < 1) return;
    if (this.asked === this.want && Date.now() - (this.askedAt ?? 0) < 2000) return;
    this.asked = this.want;
    this.askedAt = Date.now();
    run("layout.resize", { id: BLOCK, px: this.want });
  }

  // La hauteur voulue : celle du contenu, au plus la moitié de la colonne (les Spaces disent la leur).
  wanted(content) {
    const spacesH = shared("spaces-virgile.height");
    const total = spacesH != null && this.ownH != null ? spacesH + this.ownH : null;
    const max = total ? Math.max(HEAD + ROW + FOOT, Math.floor(total * SHARE)) : FALLBACK_MAX;
    return Math.min(max, Math.ceil(content));
  }

  // Note les onglets qui sortent des rangés (affichés, un agent qui vous attend, « Sortir des rangés ») :
  // le rangement automatique compte ses N jours à partir de là, sinon il les re-rangerait aussitôt. Puis,
  // si l'option est mise, range les onglets dont tous les agents (et sous-agents) sont au repos depuis
  // N jours : ni l'onglet affiché, ni un agent épinglé, affiché ou terminé sans avoir été vu.
  autoSettle(now) {
    const tabs = spaces().flatMap((s) => s.tabs ?? []);
    const info = new Map(tabs.map((x) => [x.id, x]));
    const settled = new Set(tabs.filter((x) => x.settled).map((x) => x.id));
    let dirty = false;
    if (this.prevSettled) for (const id of this.prevSettled) if (!settled.has(id) && info.has(id)) { this.sortis[id] = now; dirty = true; }
    this.prevSettled = settled;
    for (const [id, at] of Object.entries(this.sortis)) if (now - at > 60 * 86400000) { delete this.sortis[id]; dirty = true; }
    if (dirty) localStorage.setItem("ranges.sortis", JSON.stringify(this.sortis));
    const days = autoDays();
    if (!days) return;
    const shownTab = focused()?.tab;
    const all = terminals();
    const listed = new Map(allAgents(agents(), all).map((a) => [a.address, a.status]));
    const byTab = new Map();
    for (const a of allAgents(agents(), all)) if (a.tab) byTab.set(a.tab, [...(byTab.get(a.tab) ?? []), a]);
    for (const [tab, list] of byTab) {
      const x = info.get(tab);
      if (!x || x.settled || tab === shownTab) continue;
      if (list.some((a) => a.status !== "idle" || a.pinned || a.focused || this.tree(all, a.address).some((k) => kidStatus(k.t, listed) !== "idle"))) continue;
      const last = Math.max(x.changed_at ?? 0, this.sortis[tab] ?? 0, ...list.map((a) => this.since(a)));
      if (last && now - last >= days * 86400000) run("tab.settle", { id: tab });
    }
  }

  // Les agents fermés sortent de leurs groupes, une fois absents un moment d'une machine lisible
  // (une machine injoignable ou qui charge ne liste pas ses terminaux).
  forget(now) {
    const d = data();
    const refs = new Set();
    for (const [k, list] of Object.entries(d.children)) if (k !== "root") for (const r of list) if (r.startsWith("s:")) refs.add(r.slice(2));
    if (!refs.size) return;
    const live = new Set(terminals().filter((k) => k.state === "live").map((k) => k.address));
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    ready.add(null);
    const seen = new Set([...live].map(A.machineOfId));
    const keep = [...live];
    for (const id of refs) {
      if (live.has(id)) { delete this.missing[id]; continue; }
      const m = A.machineOfId(id);
      // Sa machine doit être lisible et lister au moins un terminal : sinon elle charge encore.
      if (!ready.has(m) || !seen.has(m)) { delete this.missing[id]; keep.push(id); continue; }
      this.missing[id] ??= now;
      if (now - this.missing[id] < FORGET_AFTER) keep.push(id);
    }
    const out = A.prune(d, keep, [...new Set([...refs].map(A.machineOfId))]);
    if (out) save(out);
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  // Un agent jamais vu ici part de l'heure de son dernier changement d'état selon le core (status_ms).
  track(list, now, all = []) {
    let dirty = false;
    const core = new Map(all.map((k) => [k.address, k.status_ms]));
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      const prev = this.changed[a.address];
      if (prev?.s === s) continue;
      this.changed[a.address] = { s, at: prev ? now : Math.min(now, core.get(a.address) || now) };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed.v2", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = programIcon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(SUB)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      // Un sous-agent ne se range pas : un appui dessus efface celui resté d'un glisser lâché ailleurs.
      .on_mouse_down("left", () => { this.pressed = null; this.over = null; })
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(statusMark(t, st, compact));
  }

  // ---- Glisser-déposer -------------------------------------------------------------------
  // Une cible : { kind: "a" (un agent), "g" (un groupe), "h" (l'en-tête ou un titre de section), id, ctx }.
  // ctx d'un agent : { group (son groupe, ou null), anchor (sa référence "s:adresse") }.

  aim(target, e) {
    const from = this.pressed;
    if (!from || (from.kind === target.kind && from.id === target.id)) return null;
    const y = e.local_position?.y ?? 0;
    const h = e.bounds?.height || 1;
    let pos = "into";
    if (target.kind === "a") pos = target.ctx.settled ? "into" : target.ctx.group ? (y < h / 2 ? "before" : "after") : "out";
    else if (target.kind === "h") pos = "out";
    else if (target.kind === "r") pos = "into";
    else if (target.kind === "g" && from.kind === "g" && !target.ctx?.empty) pos = y < h * 0.28 ? "before" : y > h * 0.72 ? "after" : "into";
    // Un agent sur l'en-tête d'un sous-groupe : en haut, il se range au-dessus de lui dans le
    // groupe parent ; déplié, la moitié basse le met dedans ; replié, le bas le met en dessous.
    else if (target.kind === "g" && from.kind === "a" && !target.ctx?.empty) {
      const g = data().groups[target.id];
      if (g?.parent) pos = g.folded ? (y < h * 0.35 ? "before" : y > h * 0.65 ? "after" : "into") : (y < h * 0.5 ? "before" : "into");
    }
    return this.valid(from, target, pos) ? { kind: target.kind, id: target.id, pos } : null;
  }

  valid(from, target, pos) {
    const d = data();
    if (from.kind === "a") {
      const mine = A.groupOfAgent(d, from.id);
      const ag = this.byAddrAll.get(from.id);
      // Sur l'en-tête Rangés : ranger son onglet. Un agent rangé, lâché ailleurs, en sort.
      if (target.kind === "r" || (target.kind === "a" && target.ctx.settled)) return Boolean(ag?.tab) && !ag.settled;
      const out = Boolean(mine) || Boolean(ag?.settled);
      if (target.kind === "a") return target.ctx.group ? target.ctx.anchor !== A.ref("s", from.id) : out && !target.ctx.settled;
      if (target.kind === "g") return Boolean(d.groups[target.id]) && (pos === "into" || Boolean(d.groups[target.id].parent));
      return out;
    }
    if (target.kind === "r" || (target.kind === "a" && target.ctx?.settled)) return false;
    if (from.kind === "g") {
      if (target.kind === "g") {
        if (target.id === from.id) return false;
        return pos === "into" ? A.canNest(d, from.id, target.id) : A.canNest(d, from.id, d.groups[target.id]?.parent ?? null);
      }
      if (target.kind === "a" && target.ctx.group) return A.canNest(d, from.id, target.ctx.group);
      return Boolean(d.groups[from.id]?.parent);
    }
    return false;
  }

  apply(from, target, pos) {
    let d = data();
    const side = pos === "before" ? "before" : "after";
    const ag = from.kind === "a" ? this.byAddrAll.get(from.id) : null;
    if (target.kind === "r" || (target.kind === "a" && target.ctx?.settled)) { if (ag?.tab) run(...settleArgs(ag, true)); return; }
    if (ag?.settled && ag.tab) run(...settleArgs(ag, false));
    if (from.kind === "a") {
      if (target.kind === "a" && target.ctx.group) d = A.moveAgent(d, from.id, { into: target.ctx.group, [side]: target.ctx.anchor });
      else if (target.kind === "g" && pos !== "into") d = A.moveAgent(d, from.id, { into: d.groups[target.id]?.parent ?? null, [side]: A.ref("g", target.id) });
      else if (target.kind === "g") d = A.setFolded(A.moveAgent(d, from.id, { into: target.id }), target.id, false);
      else d = A.moveAgent(d, from.id, { into: null });
    } else if (target.kind === "g") {
      d = pos === "into"
        ? A.setFolded(A.moveGroup(d, from.id, { into: target.id }), target.id, false)
        : A.moveGroup(d, from.id, { into: d.groups[target.id]?.parent ?? null, [side]: A.ref("g", target.id) });
    } else if (target.kind === "a" && target.ctx.group) d = A.moveGroup(d, from.id, { into: target.ctx.group, [side]: target.ctx.anchor });
    else d = A.moveGroup(d, from.id, { into: null });
    save(d);
  }

  // Ce qui se passe à un clic sans glisser.
  click(target) {
    if (target.kind === "a" && target.ctx?.agent) run(...openArgs(target.ctx.agent));
    else if (target.kind === "g") { const g = data().groups[target.id]; if (g) save(A.setFolded(data(), target.id, !g.folded)); }
  }

  drop(target, cx) {
    const from = this.pressed, over = this.over;
    this.pressed = null;
    this.over = null;
    if (from) {
      if (from.kind === target.kind && from.id === target.id) this.click(target);
      else if (over && over.kind === target.kind && over.id === target.id) this.apply(from, target, over.pos);
    }
    cx.notify();
  }

  // Une ligne qu'on peut tenir (agent, groupe) ou viser (en plus : l'en-tête, un titre de section).
  draggable(el, target, holdable = true) {
    return el
      // Une cible qu'on ne peut pas tenir efface un appui resté d'un glisser lâché ailleurs :
      // sinon un simple clic dessus y déposerait l'ancien.
      .on_mouse_down("left", () => { this.pressed = holdable ? { kind: target.kind, id: target.id } : null; this.over = null; })
      .on_mouse_move((e, cx) => {
        if (!this.pressed) return;
        // Une cible refusée efface le trait d'avant : il ne montre que là où ça tomberait vraiment.
        const over = this.aim(target, e);
        if (!sameAim(over, this.over)) { this.over = over; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => this.drop(target, cx));
  }

  // Le trait qui montre où ça tombe, et l'aspect de la ligne tenue.
  marks(el, target, t) {
    const o = this.over;
    const here = o && o.kind === target.kind && o.id === target.id;
    const held = this.pressed && this.pressed.kind === target.kind && this.pressed.id === target.id;
    return el.relative()
      .when(Boolean(held && this.over), (el) => el.opacity(0.5))
      .when(Boolean(here && (o.pos === "into" || o.pos === "out")), (el) => el.bg(t.selected).border_1().border_color(t.accent))
      .when(Boolean(here && (o.pos === "before" || o.pos === "after")), (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent).when(o.pos === "after", (l) => l.bottom(0)).when(o.pos === "before", (l) => l.top(0))));
  }

  // Un menu au clic droit, ouvert au-dessus du pointeur.
  menuAt(e, p, height) {
    openView("menu", p, above(e.position.x, e.position.y, 268, height), height);
  }

  render(cx) {
    if (this.sub) return this.sub.render(cx);
    const t = theme();
    const collapsed = narrow();
    // Toute la liste repliée : seul l'en-tête (le rail étroit n'en a pas, il l'ignore).
    const whole = isFolded() && !collapsed;
    const sort = sortOf();
    const all = terminals();
    let list = allAgents(agents(), all);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now, all);
    this.hold(list);
    // Les agents des onglets rangés : à part (section Rangés, en bas), du plus récemment rangé au plus ancien.
    this.byAddrAll = new Map(list.map((a) => [a.address, a]));
    const ranges = list.filter((a) => a.settled).sort((x, y) => (y.settled_at ?? 0) - (x.settled_at ?? 0));
    list = list.filter((a) => !a.settled);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);

    // Les groupes d'abord (dans leur ordre), puis les épinglés hors groupe, puis le reste.
    const d = data();
    const roots = d.children.root.map(A.unref).filter((x) => x.kind === "g" && d.groups[x.id]).map((x) => x.id);
    const byAddr = new Map(list.map((a) => [a.address, a]));
    const groupedOrder = roots.flatMap((g) => A.agentsIn(d, g)).filter((x) => byAddr.has(x));
    const inGroups = new Set(groupedOrder);
    const free = list.filter((a) => !inGroups.has(a.address));
    const pinned = free.filter((a) => a.pinned);
    const rest = free.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder([...groupedOrder, ...list.map((a) => a.address), ...ranges.map((a) => a.address)]);

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(chrome(`chevron-${open ? "down" : "right"}`)).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space · detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const ps = panes();
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      // Un agent de chat : son titre (celui de la session) dit plus que le nom de l'onglet.
      if (a.chat && a.title) return a.title;
      return tab ? title(tab, lead(tab, ps)) : a.title || a.program?.name || "";
    };
    const active = [...list, ...groupedOrder.map((x) => byAddr.get(x))];
    const everyone = [...active, ...ranges];
    const detail = new Map(everyone.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of everyone) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of everyone) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // ctx : { group, anchor } pour un agent montré dans un groupe, null sinon.
    const row = (a, i, subs = [], ctx = null) => {
      const pic = programIcon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(RAIL)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run(...openArgs(a)))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(statusMark(t, a.status, true)));
      }
      // Un agent rangé : son nom en gris, et depuis quand il est rangé plutôt que depuis quand il est dans cet état.
      const away = Boolean(ctx?.settled);
      const when = away ? a.settled_at ?? 0 : this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(chrome(isPinned ? "pin-off" : "pin")).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned, a group) the row names its space.
      const full = byPriority || isPinned || Boolean(ctx);
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const target = { kind: "a", id: a.address, ctx: { group: ctx?.group ?? null, anchor: A.ref("s", a.address), agent: a, settled: away } };
      return this.marks(this.draggable(h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(ROW)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_mouse_down("right", (e) => this.menuAt(e, { of: "agent", id: a.address }, agentMenuHeight(Boolean(ctx?.group))))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(away ? t.dim : idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(statusMark(t, a.status, byPriority && !isPinned && !ctx)), target), target, t);
    };

    // Un agent et ses sous-agents : [éléments], et leur hauteur.
    const withKids = (a, i, ctx = null) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs, ctx);
      if (this.folded.has(a.address)) return { els: [r], h: collapsed ? RAIL : ROW };
      return { els: [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority && !ctx))], h: (collapsed ? RAIL : ROW) + subs.length * SUB };
    };

    // Un groupe : son en-tête (comme ceux des Spaces : icône, nom en petit et en gris, l'état le
    // plus urgent une fois replié, le compte, la flèche), puis ses agents et sous-groupes.
    const groupBlock = (gid) => {
      const g = d.groups[gid];
      const color = A.colorOf(d, gid);
      const inside = A.agentsIn(d, gid).filter((x) => byAddr.has(x));
      const worst = STATUS_OF[Math.max(0, ...inside.map((x) => rankOf(byAddr.get(x)) ?? 0))] ?? null;
      const target = { kind: "g", id: gid };
      const header = this.marks(this.draggable(h_flex().id(`group-${gid}`).h(GROUP_H).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("right", (e) => this.menuAt(e, { of: "group", id: gid }, listHeight(g.parent ? 5 : 4, 0, 1)))
        .child(svg(icon(g.icon)).size(13).flex_none().text_color(color))
        .child(div().flex_1().min_w(0).truncate().child(g.name))
        .when(g.folded && Boolean(worst) && worst !== "idle", (el) => el.child(statusMark(t, worst, true)))
        .when(inside.length > 0, (el) => el.child(div().flex_none().child(String(inside.length))))
        .child(svg(chrome(g.folded ? "chevron-right" : "chevron-down")).size(11).flex_none()), target), target, t);
      if (g.folded) return { el: v_flex().flex_none().child(header), h: GROUP_H };
      const rows = [];
      let h = GROUP_H;
      for (const r of d.children[gid] ?? []) {
        const x = A.unref(r);
        if (x.kind === "g" && d.groups[x.id]) { const b = groupBlock(x.id); rows.push(b.el); h += b.h; }
        else if (x.kind === "s" && byAddr.has(x.id)) { const k = withKids(byAddr.get(x.id), 0, { group: gid }); rows.push(...k.els); h += k.h; }
      }
      if (!rows.length) {
        const empty = { kind: "g", id: gid, ctx: { empty: true } };
        const away = A.agentsIn(d, gid).filter((x) => this.byAddrAll.get(x)?.settled).length;
        rows.push(this.draggable(h_flex().id(`group-empty-${gid}`).h(GROUP_H).flex_none().px(8).items_center().rounded(7).text_size(11.5).text_color(t.dim)
          .child(away ? `${away} agent${away > 1 ? "s" : ""} dans Rangés` : "Vide : glissez-y des agents"), empty, false));
        h += GROUP_H;
      }
      return { el: v_flex().flex_none().child(header)
        .child(v_flex().flex_none().relative().pl(12)
          .child(div().absolute().left(11).top(2).bottom(2).w(2).rounded(1).bg(`${color}55`))
          .children(rows)), h };
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in the list, so neighbours make a group.
    const sections = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (sections.at(-1)?.id === id) sections.at(-1).members.push(a);
      else sections.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A section's header; it folds the section. Folded, it says how many and the most urgent state.
    // On y lâche un agent ou un sous-groupe pour le sortir de son groupe.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const target = { kind: "h", id: g.id };
      return this.marks(this.draggable(h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(SECTION_H)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(statusMark(t, top, true)))
          .child(svg(chrome("chevron-right")).size(11).flex_none().text_color(t.dim))), target, false), target, t);
    };

    // L'en-tête Rangés : il les replie ou les déplie (replié par défaut) ; on y lâche un agent pour ranger son onglet.
    const rangesHead = () => {
      const open = rangesOpen();
      const target = { kind: "r", id: "ranges" };
      return this.marks(this.draggable(h_flex().id("ranges-head").px(8).pt(8).h(SECTION_H).flex_none().gap(6).items_center()
        .text_size(11).font_medium().text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .tooltip("Onglets rangés (tab.settle) : ils tournent toujours. Un onglet affiché, ou dont un agent vous attend, revient de lui-même. Lâchez un agent ici pour ranger son onglet.")
        .on_click(() => setRangesOpen(!open))
        .child(svg(icon("archive")).size(12).flex_none())
        .child(div().child("Rangés"))
        .child(div().child(String(ranges.length)))
        .child(div().flex_1())
        .child(svg(chrome(open ? "chevron-down" : "chevron-right")).size(11).flex_none()), target, false), target, t);
    };

    let rows = [];
    const foot = []; // la section Rangés, sous la liste
    let content = 0;
    if (whole) content = 1 + HEAD;
    else if (collapsed) {
      const flat = [...groupedOrder.map((x) => byAddr.get(x)), ...list];
      flat.forEach((a, i) => { const k = withKids(a, i); rows.push(...k.els); content += k.h; });
      content += RAIL_FOOT + 1;
    } else {
      for (const gid of roots) { const b = groupBlock(gid); rows.push(b.el); content += b.h; }
      if (roots.length && sections.length) { rows.push(div().h(6).flex_none()); content += 6; }
      for (const g of sections) {
        rows.push(header(g));
        content += SECTION_H;
        if (this.folded.has(g.id)) continue;
        for (const a of g.members) { const k = withKids(a, 0); rows.push(...k.els); content += k.h; }
      }
      if (ranges.length) {
        foot.push(rangesHead());
        content += 1 + SECTION_H + 4;
        if (rangesOpen()) {
          const els = [];
          let h = 0;
          for (const a of ranges) { const k = withKids(a, 0, { group: null, settled: true }); els.push(...k.els); h += k.h; }
          foot.push(v_flex().id("ranges-list").flex_none().max_h(RANGES_MAX).overflow_y_scrollbar().children(els));
          content += Math.min(h, RANGES_MAX);
        }
      }
      content += 1 + HEAD + FOOT + (list.length === 0 && roots.length === 0 && ranges.length === 0 ? EMPTY_H : 0);
    }
    this.want = this.wanted(content);

    const headTarget = { kind: "h", id: "" };
    // « Agents » et sa flèche replient toute la liste. Repliée, l'en-tête dit combien d'agents et
    // combien vous attendent, sont en cours ou terminés (sous-agents compris, comme les sections).
    const counts = { blocked: 0, working: 0, done: 0, idle: 0 };
    for (const a of active) counts[STATUS_OF[rankOf(a)] ?? "idle"] += 1;
    const said = [...["blocked", "working", "done", "idle"].filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${WORDS[s]}`),
      ...(ranges.length ? [`${ranges.length} rangé${ranges.length > 1 ? "s" : ""}`] : [])].join(" · ");
    const headTitle = h_flex().id("agents-title").min_w(0).gap(5).items_center().cursor_pointer()
      .text_color(t.dim).hover((s) => s.text_color(t.foreground))
      .tooltip(whole ? `Déplier la liste${said ? ` · ${said}` : ""}` : "Replier toute la liste")
      .on_click((_e, cx) => { cx.stop_propagation(); setFolded(!whole); })
      .child(div().text_size(11.5).font_medium().child("Agents"))
      .child(svg(chrome(whole ? "chevron-right" : "chevron-down")).size(11).flex_none())
      .when(whole, (el) => el
        .child(div().text_size(11).child(String(active.length)))
        .children(["blocked", "working", "done"].filter((s) => counts[s] > 0).map((s) => h_flex().id(`agents-n-${s}`).flex_none().gap(3).items_center().pl(4)
          .child(statusMark(t, s, true))
          .child(div().text_size(11).text_color(t[s] ?? t.dim).child(String(counts[s]))))));
    const btn = (id, tip, svgPath, f) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (e) => { this.btnAt = { x: e.position.x, y: e.position.y }; })
      .on_click(() => f(this.btnAt ?? { x: 40, y: 600 }))
      .child(svg(svgPath).size(14));
    return v_flex()
      .id("agents-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .on_size_change((size, cx) => { this.ownH = size.height; cx.notify(); })
      // Sortir de la liste en tenant un agent ou un groupe annule le glisser (il n'y a pas de
      // « relâché ailleurs » : sans ça, l'appui resterait et le prochain survol y déposerait).
      .on_hover((hovered, cx) => { if (!hovered && this.pressed) { this.pressed = null; this.over = null; cx.notify(); } })
      .on_mouse_down_out((_e, cx) => { if (this.pressed) { this.pressed = null; this.over = null; cx.notify(); } })
      .when(!collapsed, (el) =>
        el.child(this.marks(this.draggable(
          h_flex()
            .id("agents-head")
            .pl(16)
            .pr(10)
            .h(HEAD)
            .pt(whole ? 10 : 14)
            .pb(whole ? 9 : 5)
            .flex_none()
            .items_center()
            .justify_between()
            .on_mouse_down("right", (e) => this.menuAt(e, { of: "header" }, headerMenuHeight()))
            .child(headTitle)
            .child(h_flex().flex_none().gap(2).items_center()
              .child(btn("ag-kanban", "Vue kanban de tous les agents", icon("square-kanban"), () => openView("kanban", {})))
              .when(!whole, (el) => el.child(btn("ag-sort", `Sort agents: ${sort.label}`, chrome(sort.icon), (p) => openView("sort", {}, above(p.x - 180, p.y, 220, listHeight(2, 1)), listHeight(2, 1)))))
              .child(btn("ag-menu", "Options de la liste", icon("menu"), (p) => openView("menu", { of: "header" }, above(p.x - 240, p.y, 268, headerMenuHeight()), headerMenuHeight())))),
          headTarget, false), headTarget, t)),
      )
      .when(list.length === 0 && roots.length === 0 && ranges.length === 0 && !collapsed && !whole, (el) =>
        el.child(div().h(EMPTY_H).flex_none().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .when(!whole, (el) => el.child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(collapsed ? 0 : FOOT).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
        .children(rows)))
      .when(!whole && !collapsed && foot.length > 0, (el) => el.child(v_flex().id("ranges-foot").flex_none().px(8).pb(4).border_t(1).border_color(t.border)
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
        .children(foot)))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(RAIL_FOOT)
            .flex_none()
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}

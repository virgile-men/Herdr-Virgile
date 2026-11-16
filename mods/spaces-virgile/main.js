// Spaces de Herdr-Virgile : le mod livré `spaces` (0.1.12, cloné le 2026-11-14), avec en plus
//   - des étiquettes libres (nom, couleur) sur les terminaux (onglets), avec la machine de chacun ;
//   - des groupes de spaces, en haut de la liste, imbricables sur 8 niveaux, avec nom, icône, et
//     une couleur que les sous-groupes héritent de leur groupe racine. Un groupe peut mêler des
//     spaces de plusieurs machines ; les spaces hors groupe restent sous leur machine ;
//   - le + de l'en-tête, qui demande sur quelle machine ouvrir le nouveau space ;
//   - l'avatar d'un space au choix (icône ou initiale, couleur) ;
//   - les onglets d'un space sous son nom : le premier, et tous une fois déplié (flèche à droite).
// Glisser : un space sur un groupe l'y range, entre deux lignes d'un groupe l'y place, sur une
// machine ou sur l'en-tête Spaces le sort de son groupe ; un groupe sur un autre s'y imbrique
// (au milieu de la ligne) ou se range à côté (en haut ou en bas). Clic droit : les menus (vues.js).
// Le modèle est dans arbre.js, rangé dans shared("spaces-virgile") ; les groupes ne changent
// jamais l'ordre des spaces de herdr.
//
// Du mod livré : avatars de couleur, worktrees sous leur checkout (ils suivent leur dépôt dans
// son groupe), dépôt, branche et avance/retard seulement quand c'est inhabituel.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, terminals, run, exec, hc, theme, shared, setShared, watchFolder, window, layout, props, nextCommand } from "herdr";
import * as A from "./arbre.js";
import { data, save, PENDING, OPTIONS, rectOf, openView, icon, chrome, avatar, tabTitle, tabTerminals } from "./etat.js";
import { VIEWS } from "./vues.js";

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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;


// Un space fermé n'est oublié de ses groupes et étiquettes qu'après ce délai d'absence
// (et seulement si sa machine est lisible : arbre.js prune).
const FORGET_AFTER = 15000;

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

const URGENCY = { blocked: 3, done: 2, working: 1, idle: 0 };
const sameAim = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && (a?.id ?? null) === (b?.id ?? null) && (a?.pos ?? null) === (b?.pos ?? null);

export default class Spaces extends View {
  init(_props, cx) {
    // En overlay (menus, dialogues) : une vue de vues.js, rien de la barre.
    const view = props()?.view;
    if (view) {
      this.sub = new VIEWS[view]();
      this.sub.init(cx);
      return;
    }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null; // { kind: "s" | "g", id } : ce qu'on tient
    this.over = null; // { kind: "s" | "g" | "m" | "h", id, pos } : où ça tomberait
    this.missing = {}; // space -> depuis quand il n'est plus là
    this.open = new Set(JSON.parse(localStorage.getItem("spaces.open") ?? "[]")); // spaces dépliés (leurs onglets)
    this.prunedAt = 0;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // `herdr-app do spaces-virgile.<vue>` : ouvre une vue sur le space montré (pour essayer).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const sp = spaces();
        const s = sp.find((x) => x.active) ?? sp[0];
        const g = data().children.root.map(A.unref)[0]?.id;
        const at = { x: 40, y: 120 };
        if (c === "labels") openView("labels", { tab: (s?.tabs ?? []).find((x) => x.active)?.id });
        else if (c === "group") openView("group", g ? { id: g } : {});
        else if (c === "new-group") openView("group", {});
        else if (c === "machines") openView("machines", {}, at);
        else if (c === "move") openView("move", { space: s?.id }, at);
        else if (c === "menu-space") openView("menu", { of: "space", id: s?.id }, at);
        else if (c === "menu-group" && g) openView("menu", { of: "group", id: g }, at);
        else if (c === "menu-header") openView("menu", { of: "header" }, at);
        else if (c === "menu-tab") openView("menu", { of: "tab", id: (s?.tabs ?? []).find((x) => x.active)?.id }, at);
        else if (c === "look") openView("look", { space: s?.id });
        cx.notify();
      }
    });
  }

  close() {
    this.sub?.close?.();
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    this.adopt(sp, now);
    this.moveTags(sp);
    if (now - this.prunedAt > 5000) { this.prunedAt = now; this.forget(sp, now); }
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // « Nouveau space ici » : le space qui vient d'apparaître sur cette machine va dans le groupe.
  adopt(sp, now) {
    const p = shared(PENDING);
    if (!p) return;
    if (now - (p.at ?? 0) > 20000) return setShared(PENDING, null);
    const s = sp.find((x) => (x.machine ?? null) === (p.machine ?? null) && !p.before.includes(x.id));
    if (!s) return;
    setShared(PENDING, null);
    let d = A.moveSpace(data(), s.id, { into: p.group });
    d = A.setFolded(d, p.group, false);
    save(d);
  }

  // Les étiquettes étaient posées sur les spaces (jusqu'au 2026-11-15) ; elles vont sur les
  // terminaux : celles d'un space passent à son premier onglet, dès que le space est là.
  moveTags(sp) {
    const d = data();
    let changed = false;
    for (const s of sp) {
      const mine = d.tags[s.id];
      const first = s.tabs?.[0]?.id;
      if (!mine || !first) continue;
      d.tags[first] = [...new Set([...(d.tags[first] ?? []), ...mine])];
      delete d.tags[s.id];
      changed = true;
    }
    if (changed) save(d);
  }

  // Les spaces fermés sortent de leurs groupes et étiquettes, une fois absents un moment d'une
  // machine lisible (une machine injoignable ou qui charge ne liste pas les siens).
  forget(sp, now) {
    const d = data();
    const live = new Set(sp.flatMap((s) => [s.id, ...(s.tabs ?? []).map((c) => c.id)]));
    const refs = new Set([...Object.keys(d.tags), ...Object.keys(d.looks)]);
    for (const [k, list] of Object.entries(d.children)) if (k !== "root") for (const r of list) if (r.startsWith("s:")) refs.add(r.slice(2));
    const ms = machines();
    const ready = ms.filter((m) => m.layout === "ready").map((m) => m.name ?? null);
    if (!ms.some((m) => m.name === null) && sp.some((s) => !s.machine)) ready.push(null);
    // L'absence ne compte que pendant que sa machine est lisible : une machine qui revient a
    // le temps de relister ses spaces avant qu'on oublie quoi que ce soit.
    const keep = [...live];
    for (const id of refs) {
      if (live.has(id)) { delete this.missing[id]; continue; }
      if (!ready.includes(A.machineOfId(id))) { delete this.missing[id]; keep.push(id); continue; }
      this.missing[id] ??= now;
      if (now - this.missing[id] < FORGET_AFTER) keep.push(id);
    }
    const out = A.prune(d, keep, ready);
    if (out) save(out);
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // ---- Glisser-déposer -------------------------------------------------------------------
  // Une cible : { kind: "s" (un space), "g" (un groupe), "m" (une machine), "h" (l'en-tête), id, ctx }.
  // ctx d'un space : { group (le groupe où il est montré, ou null), anchor (la référence à côté de
  // laquelle on range : la sienne, ou celle de son dépôt pour un worktree), machine, kid }.

  aim(target, e) {
    const from = this.pressed;
    if (!from || (from.kind === target.kind && from.id === target.id)) return null;
    const y = e.local_position?.y ?? 0;
    const h = e.bounds?.height || 1;
    let pos = "into";
    if (target.kind === "s") pos = target.ctx.kid ? "after" : y < h / 2 ? "before" : "after";
    else if (target.kind === "g" && from.kind === "g" && !target.ctx?.empty) pos = y < h * 0.28 ? "before" : y > h * 0.72 ? "after" : "into";
    // Un space sur l'en-tête d'un sous-groupe : en haut, il se range au-dessus de lui dans le
    // groupe parent ; déplié, la moitié basse le met dedans ; replié, le bas le met en dessous.
    else if (target.kind === "g" && from.kind === "s" && !target.ctx?.empty) {
      const g = data().groups[target.id];
      if (g?.parent) pos = g.folded ? (y < h * 0.35 ? "before" : y > h * 0.65 ? "after" : "into") : (y < h * 0.5 ? "before" : "into");
    }
    return this.valid(from, target, pos) ? { kind: target.kind, id: target.id, pos } : null;
  }

  valid(from, target, pos) {
    const d = data();
    if (from.kind === "s") {
      const mine = A.groupOfSpace(d, from.id);
      if (target.kind === "s") {
        if (target.ctx.group) return target.ctx.anchor !== A.ref("s", from.id);
        const s = spaces().find((x) => x.id === from.id);
        return Boolean(mine) || (s && (s.machine ?? null) === target.ctx.machine);
      }
      if (target.kind === "g") return Boolean(d.groups[target.id]) && (pos === "into" || Boolean(d.groups[target.id].parent));
      return Boolean(mine);
    }
    if (from.kind === "g") {
      if (target.kind === "g") {
        if (target.id === from.id) return false;
        return pos === "into" ? A.canNest(d, from.id, target.id) : A.canNest(d, from.id, d.groups[target.id]?.parent ?? null);
      }
      if (target.kind === "s") return Boolean(target.ctx.group) && A.canNest(d, from.id, target.ctx.group);
      return Boolean(d.groups[from.id]?.parent);
    }
    return false;
  }

  apply(from, target, pos) {
    let d = data();
    const side = pos === "before" ? "before" : "after";
    if (from.kind === "s") {
      if (target.kind === "s" && target.ctx.group) d = A.moveSpace(d, from.id, { into: target.ctx.group, [side]: target.ctx.anchor });
      else if (target.kind === "s") {
        if (A.groupOfSpace(d, from.id)) d = A.moveSpace(d, from.id, { into: null });
        const sp = spaces();
        const f = sp.findIndex((s) => s.id === from.id), to = sp.findIndex((s) => s.id === target.id);
        if (f !== -1 && to !== -1 && (sp[f].machine ?? null) === (sp[to].machine ?? null)) {
          const index = f < to ? (side === "before" ? to : to + 1) : (side === "before" ? to + 1 : to + 2);
          if (index !== f + 1) run("space.move", { id: from.id, index });
        }
      } else if (target.kind === "g" && pos !== "into") d = A.moveSpace(d, from.id, { into: d.groups[target.id]?.parent ?? null, [side]: A.ref("g", target.id) });
      else if (target.kind === "g") d = A.setFolded(A.moveSpace(d, from.id, { into: target.id }), target.id, false);
      else d = A.moveSpace(d, from.id, { into: null });
    } else if (target.kind === "g") {
      d = pos === "into"
        ? A.setFolded(A.moveGroup(d, from.id, { into: target.id }), target.id, false)
        : A.moveGroup(d, from.id, { into: d.groups[target.id]?.parent ?? null, [side]: A.ref("g", target.id) });
    } else if (target.kind === "s") d = A.moveGroup(d, from.id, { into: target.ctx.group, [side]: target.ctx.anchor });
    else d = A.moveGroup(d, from.id, { into: null });
    save(d);
  }

  // Ce qui se passe à un clic sans glisser.
  click(target) {
    if (target.kind === "s") run("space.select", { id: target.id });
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

  // Une ligne qu'on peut tenir (space, groupe) ou viser (en plus : machine, en-tête).
  draggable(el, target, holdable = true) {
    return el
      // Une cible qu'on ne peut pas tenir (machine, en-tête) efface un appui resté d'un glisser
      // lâché ailleurs : sinon un simple clic dessus y déposerait l'ancien.
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
      .when(Boolean(here && o.pos === "into"), (el) => el.bg(t.selected).border_1().border_color(t.accent))
      .when(Boolean(here && (o.pos === "before" || o.pos === "after")), (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent).when(o.pos === "after", (l) => l.bottom(0)).when(o.pos === "before", (l) => l.top(0))));
  }

  // ---- Groupes ---------------------------------------------------------------------------

  // Les spaces que montrent les groupes (avec les worktrees qui suivent leur dépôt).
  placedIn(d, kids, explicit, live) {
    const placed = new Set();
    for (const r of d.children.root) {
      const x = A.unref(r);
      if (x.kind !== "g" || !d.groups[x.id]) continue;
      for (const id of A.spacesIn(d, x.id)) {
        if (!live.has(id)) continue;
        placed.add(id);
        for (const k of kids[id] ?? []) if (!explicit.has(k.w.id)) placed.add(k.w.id);
      }
    }
    return placed;
  }

  groupBlock(d, gid, ctx, t) {
    const g = d.groups[gid];
    const color = A.colorOf(d, gid);
    const inside = A.spacesIn(d, gid).filter((id) => ctx.live.has(id));
    const worst = inside.map((id) => ctx.live.get(id).w.status).reduce((a, s) => ((URGENCY[s] ?? -1) > (URGENCY[a] ?? -1) ? s : a), null);
    const target = { kind: "g", id: gid };
    // Comme l'en-tête d'une machine : icône, nom en petit et en gris, puis le +, le compte et la flèche.
    const header = this.marks(this.draggable(h_flex().id(`group-${gid}`).h(26).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("right", () => openView("menu", { of: "group", id: gid }))
      .child(svg(icon(g.icon)).size(13).flex_none().text_color(color))
      .child(div().flex_1().min_w(0).truncate().child(g.name))
      .when(g.folded && (worst === "blocked" || worst === "done"), (el) => el.child(div().size(6).rounded(3).flex_none().bg(tone(t, worst))))
      .child(div().id(`group-add-${gid}`).flex_none().px(4).rounded(4).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Nouveau space dans ce groupe")
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.addAt = rectOf(e); })
        .on_click(() => {
          const r = this.addAt;
          openView("machines", { group: gid }, r ? { x: Math.max(8, r.x + r.width - 250), y: r.y + r.height + 4 } : null);
        })
        .child("+"))
      .when(inside.length > 0, (el) => el.child(div().flex_none().child(String(inside.length))))
      .child(svg(chrome(g.folded ? "chevron-right" : "chevron-down")).size(11).flex_none()), target), target, t);
    if (g.folded) return v_flex().flex_none().child(header);
    const rows = [];
    for (const r of d.children[gid] ?? []) {
      const x = A.unref(r);
      if (x.kind === "g" && d.groups[x.id]) rows.push(this.groupBlock(d, x.id, ctx, t));
      else if (x.kind === "s" && ctx.live.has(x.id)) {
        const row = ctx.live.get(x.id);
        rows.push(this.row({ ...row, tree: null }, t, { group: gid, anchor: r, machine: row.w.machine ?? null, kid: false }, true));
        for (const k of ctx.kids[x.id] ?? []) if (!ctx.explicit.has(k.w.id)) rows.push(this.row(k, t, { group: gid, anchor: r, machine: k.w.machine ?? null, kid: true }, true));
      }
    }
    if (!rows.length) {
      const empty = { kind: "g", id: gid, ctx: { empty: true } };
      rows.push(this.draggable(h_flex().id(`group-empty-${gid}`).h(26).flex_none().px(8).items_center().rounded(7).text_size(11.5).text_color(t.dim)
        .child("Vide : glissez-y des spaces"), empty, false));
    }
    return v_flex().flex_none().child(header)
      .child(v_flex().flex_none().relative().pl(12)
        .child(div().absolute().left(11).top(2).bottom(2).w(2).rounded(1).bg(`${color}55`))
        .children(rows));
  }

  // Les groupes, puis les machines avec leurs spaces hors groupe.
  grouped(t, collapsed) {
    this.panesNow = panes();
    this.termsNow = terminals();
    const rows = this.ordered();
    const byMachine = Boolean(shared(OPTIONS)?.byMachine);
    if (collapsed) return byMachine ? this.machineSections(rows, t, true, new Set()) : rows.map((r) => this.compact(r, t));
    const d = data();
    const live = new Map(rows.map((r) => [r.w.id, r]));
    const kids = {};
    let main = null;
    for (const r of rows) {
      if (!r.tree) main = r;
      else if (main) (kids[main.w.id] ??= []).push(r);
    }
    const explicit = new Set();
    for (const [k, list] of Object.entries(d.children)) if (k !== "root") for (const r of list) if (r.startsWith("s:")) explicit.add(r.slice(2));
    const placed = this.placedIn(d, kids, explicit, live);
    const ctx = { live, kids, explicit };
    const groups = d.children.root.map(A.unref).filter((x) => x.kind === "g" && d.groups[x.id]).map((x) => this.groupBlock(d, x.id, ctx, t));
    const rest = rows.filter((r) => !placed.has(r.w.id));
    return [...groups, ...(groups.length ? [div().h(6).flex_none()] : []), ...(byMachine ? this.machineSections(rest, t, false, placed) : this.flat(rest, t, groups.length > 0))];
  }

  // Sans tri par machine : les spaces hors groupe en une liste, dans l'ordre de Herdr (cet ordinateur,
  // puis les machines par nom) ; chaque terminal dit sa machine. Une machine qui charge le dit en bas.
  flat(rows, t, hasGroups) {
    const out = rows.map((r) => this.row(r, t, { group: null, anchor: null, machine: r.w.machine ?? null, kid: Boolean(r.tree) }, false));
    const loading = machines().filter((m) => m.name && m.layout === "loading").map((m) => m.name);
    if (loading.length) out.push(div().id("machines-loading").h(26).flex_none().px(8).flex().items_center().text_size(11.5).text_color(t.dim)
      .child(`Chargement : ${loading.join(", ")}…`));
    if (!out.length && !hasGroups) out.push(h_flex().id("space-none").h(28).flex_none().px(8).gap(7).items_center().rounded(7)
      .text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("space.new", { machine: "" }))
      .child(svg(chrome("plus")).size(12)).child("Nouveau space"));
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  machineSections(rows, t, collapsed, placed) {
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t, { group: null, anchor: null, machine: r.w.machine ?? null, kid: Boolean(r.tree) }, false));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    // Les spaces de cette machine sont tous dans des groupes : rien dessous (le + reste là).
    const allGrouped = m => spaces().some(s => (s.machine ?? null) === m && placed.has(s.id));
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const target = { kind: "m", id: m ?? "" };
      const head = this.marks(this.draggable(h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())), target, false), target, t);
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const under = mine.length ? mine.map(draw) : loading(m) ? [loadingRow(m)] : allGrouped(m) ? [] : [empty];
      return [head, ...(folded ? [] : under)];
    });
  }

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" · ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)));
  }

  // Des étiquettes en pastilles.
  chips(labels, t) {
    return labels.map((l) =>
      h_flex().h(17).px(6).gap(4).flex_none().items_center().rounded(9).bg(`${l.color}24`).border_1().border_color(`${l.color}66`)
        .child(div().size(6).rounded(3).flex_none().bg(l.color))
        .child(div().max_w(120).truncate().text_size(10.5).text_color(t.foreground).child(l.name)));
  }

  // La machine d'un terminal, comme une étiquette : « [serveur] lxc-perso · t6 · /root », ou
  // « [écran] · t1k · /Users/… » sur cet ordinateur.
  // Le chemin se coupe à la fin quand la barre est trop étroite.
  machineChip(w, term, t) {
    // Cet ordinateur : l'icône suffit (un nom de machine ici prêterait à confusion) ; l'infobulle le dit.
    const text = (w.machine ? "" : "\u00b7 ") + [w.machine, term?.address, term?.cwd].filter(Boolean).join(" \u00b7 ");
    const full = [w.machine ?? "This computer", term?.address, term?.cwd].filter(Boolean).join(" \u00b7 ");
    return h_flex().min_w(0).child(h_flex().id(`machine-chip-${w.id}-${term?.address ?? "aucun"}`).h(17).px(6).gap(4).min_w(0).flex_shrink(1).items_center().rounded(9)
      .tooltip(full)
      .border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
      .child(svg(chrome(w.machine ? "server" : "monitor")).size(10).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().child(text)));
  }

  toggleOpen(id) {
    this.open.has(id) ? this.open.delete(id) : this.open.add(id);
    localStorage.setItem("spaces.open", JSON.stringify([...this.open]));
  }

  // Un terminal (onglet) sous un space : sa ligne (un clic l'affiche, clic droit : son menu), puis sa
  // machine et ses étiquettes en pastilles.
  // Le trait part du centre de l'avatar (axis) : vertical jusqu'au terminal suivant, ou jusqu'à
  // celui-ci pour le dernier, puis vers le nom. Il monte de 3 px (l'écart entre les lignes) pour
  // rejoindre l'avatar ou le trait du terminal d'avant.
  tabLine(w, c, last, indent, axis, t, d) {
    const shown = c.active && w.active;
    const ink = t.dim + "99";
    const dot = c.status === "blocked" || c.status === "done" || c.status === "working";
    const terms = tabTerminals(c, this.panesNow, this.termsNow);
    const labels = A.labelsOf(d, c.id);
    return v_flex().flex_none().gap(2).relative()
      .child(div().absolute().left(axis).w(1).top(-3).when(last, (el) => el.h(13)).when(!last, (el) => el.bottom(0)).bg(ink))
      .child(div().absolute().left(axis).top(10).h(1).w(indent - axis - 5).bg(ink))
      .child(h_flex().id(`tab-${c.id}`).h(20).flex_none().pl(indent).pr(4).gap(6).items_center().rounded(5)
        .text_size(11.5).text_color(shown ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openView("menu", { of: "tab", id: c.id }); })
        // tab.select passe aussi au space de l'onglet.
        .on_click(() => run("tab.select", { id: c.id }))
        .child(div().flex_1().min_w(0).truncate().when(shown, (el) => el.font_medium()).child(tabTitle(c, this.panesNow)))
        .when(dot, (el) => el.child(div().size(6).rounded(3).flex_none().bg(tone(t, c.status)))))
      .child(v_flex().pl(indent).pr(4).gap(3)
        .children((terms.length ? terms : [null]).map((term) => this.machineChip(w, term, t)))
        .when(labels.length > 0, (el) => el.child(h_flex().flex_wrap().gap(4).children(this.chips(labels, t)))));
  }

  // `ctx` : où la ligne est montrée (voir Glisser-déposer). Sous le nom : le premier terminal
  // (onglet), ou tous quand le space est déplié (la flèche à droite, s'il en a plusieurs), chacun
  // avec sa machine et ses étiquettes.
  row({ w, g, tree }, t, ctx, inGroup) {
    const on = w.active;
    const d = data();
    const tabs = w.tabs ?? [];
    const open = tabs.length > 1 && this.open.has(w.id);
    const shownTabs = open ? tabs : tabs.slice(0, 1);
    // Le nom des terminaux sous celui du space ; le trait sous le centre de l'avatar (18 px), ou de
    // l'icône de branche d'un worktree (13 px, après 22 px).
    const indent = tree ? 44 : 27;
    const axis = tree ? 28 : 9;
    const target = { kind: "s", id: w.id, ctx };
    return this.marks(this.draggable(v_flex()
      .id(`space-${w.id}`)
      .px(8)
      .min_h(rowHeight({ tree }))
      .py(5)
      .gap(3)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("right", () => openView("menu", { of: "space", id: w.id }))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(avatar(t, w, d)))
          .child(div().when(!inGroup, (el) => el.flex_shrink(0)).when(inGroup, (el) => el.flex_shrink(1).min_w(24)).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          .when(tabs.length > 1, (el) => el.child(h_flex().id(`space-open-${w.id}`).flex_none().h(18).px(3).gap(3).items_center().rounded(4)
            .text_size(11).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(open ? "Replier les onglets" : `Montrer les ${tabs.length} onglets`)
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.toggleOpen(w.id); cx.notify(); })
            .when(!open, (b) => b.child(String(tabs.length)))
            .child(svg(chrome(open ? "chevron-down" : "chevron-right")).size(11)))),
      )
      .children(shownTabs.map((c, i) => this.tabLine(w, c, i === shownTabs.length - 1, indent, axis, t, d))), target), target, t);
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render(cx) {
    if (this.sub) return this.sub.render(cx);
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const headTarget = { kind: "h", id: "" };
    return v_flex().id("spaces-root").size_full().min_h(0).bg(t.chrome).text_size(13)
      // Sa hauteur, pour la liste Agents collée en bas (agents-virgile) : elle en prend au plus la moitié.
      .on_size_change((size) => { const h = Math.round(size.height); if (!props()?.view && Math.abs((shared("spaces-virgile.height") ?? 0) - h) > 2) setShared("spaces-virgile.height", h); })
      // Sortir de la barre en tenant un space ou un groupe annule le glisser (il n'y a pas de
      // « relâché ailleurs » : sans ça, l'appui resterait et le prochain survol y déposerait).
      .on_hover((hovered, cx) => { if (!hovered && this.pressed) { this.pressed = null; this.over = null; cx.notify(); } })
      .on_mouse_down_out((_e, cx) => { if (this.pressed) { this.pressed = null; this.over = null; cx.notify(); } })
      .child(this.marks(this.draggable(h_flex().id("spaces-head").h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .on_mouse_down("right", () => openView("menu", { of: "header" }))
        .when(!collapsed, el => el.child("Spaces"))
        .child(h_flex().flex_none().gap(2).items_center()
        // Le menu ☰ : trier par machine, nouveau groupe, étiquettes, tout replier (le même qu'au clic droit).
        .when(!collapsed, (el) => el.child(div().id("spaces-menu").size(26).flex_none().flex().items_center().justify_center().rounded(6)
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Options de la liste")
          .on_mouse_down("left", (e) => { this.menuAt = rectOf(e); })
          .on_click(() => {
            const r = this.menuAt;
            openView("menu", { of: "header" }, r ? { x: Math.max(8, r.x + r.width - 268), y: r.y + r.height + 4 } : null);
          })
          .child(svg(icon("menu")).size(14))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Nouveau space : choisir la machine")
          .on_mouse_down("left", (e) => { this.plusAt = rectOf(e); })
          .on_click(() => {
            const r = this.plusAt;
            openView("machines", {}, r ? { x: Math.max(8, r.x + r.width - 250), y: r.y + r.height + 4 } : null);
          })
          .child(svg("mods/workspace-chrome/plus.svg").size(14)))), headTarget, false), headTarget, t))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}

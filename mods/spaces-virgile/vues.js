// Les popups et dialogues de la barre Spaces de Herdr-Virgile, ouverts par etat.js openView :
// cette même mod en overlay, avec props { view, ... } (main.js choisit la classe d'après view).
//   menu      { of: "space" | "tab" | "group" | "header", id }   le clic droit
//   machines  { group? }                                 le + : sur quelle machine ouvrir un space
//   move      { space }                                  Déplacer vers un groupe
//   movetab   { tab }                                    Déplacer un onglet vers un autre space (même machine)
//   labels    { tab? }                                   les étiquettes (d'un terminal/onglet, ou toutes)
//   group     { id? | parent? | withSpace? | withSpaces?, name? }  Nouveau groupe / Modifier le groupe
//             (withSpaces : [cible, lâché], deux spaces de machines différentes glissés l'un sur l'autre)
//   look      { space }                                  l'icône et la couleur de l'avatar d'un space

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, run, spaces, panes, machines, exec, shared, setShared } from "herdr";
import * as A from "./arbre.js";
import { data, save, PENDING, OPTIONS, MOVE_TAB, openView, icon, chrome, avatar, avatarColor, tabTitle } from "./etat.js";
import { targetsFor } from "./deplacer.js";

// Où est un space maintenant : le dossier de son premier terminal, sinon celui de sa création.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// Le checkout d'un space : "main" (le dépôt), "linked" (un worktree), ou null (comme le menu livré).
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

const worktree = (args) => openOverlay({ mod: "worktree", kind: "dialog", ...(args.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: args });

// Les machines où ouvrir un space : cet ordinateur, puis les autres par nom.
export function machineList() {
  const ms = machines();
  const names = [...new Set(ms.map((m) => m.name).filter(Boolean))].sort();
  const state = (n) => (n === null ? "ready" : ms.find((m) => m.name === n)?.layout ?? "unavailable");
  return [null, ...names].map((name) => ({ name, layout: state(name) }));
}

function button(t, id, text, primary, onClick, disabled = false) {
  return h_flex().id(id).h(32).px(14).items_center().rounded(8).flex_none()
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
    .when(disabled, (el) => el.opacity(0.45))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick))
    .child(text);
}

const label = (t, text) => div().pb(6).text_size(11.5).text_color(t.dim).child(text);

function field(t, state, focused, error = false) {
  return Input.new(state).h(34).px(10).rounded(8).border_1()
    .border_color(error ? t.blocked : focused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
}

// Les couleurs proposées, puis un champ hexadécimal pour n'importe quelle autre.
function colorPicker(t, id, color, hexState, hexFocused, onPick) {
  const valid = A.hex(hexState.value());
  return v_flex().gap(8)
    .child(h_flex().gap(6).flex_wrap().children(A.PALETTE.map((c, i) =>
      div().id(`${id}-sw-${i}`).size(24).rounded(12).flex_none().bg(c).cursor_pointer()
        .border_2().border_color(c === color ? t.foreground : "#00000000")
        .hover((s) => s.opacity(0.85))
        .on_click((_e, cx) => { onPick(c); cx.notify(); }))))
    .child(h_flex().gap(8).items_center()
      .child(div().size(24).rounded(6).flex_none().bg(color ?? t.dim).border_1().border_color(t.border))
      .child(field(t, hexState, hexFocused, Boolean(hexState.value().trim()) && !valid).w(120))
      .child(div().text_size(11.5).text_color(t.dim).child("Couleur libre : #rrggbb")));
}

// La grille des icônes ; `initial` : une première case pour l'initiale (null).
function iconGrid(t, id, selected, color, onPick, initial = null) {
  const cells = [...(initial !== null ? [null] : []), ...A.ICONS];
  const PER = 11;
  const rows = [];
  for (let i = 0; i < cells.length; i += PER) rows.push(cells.slice(i, i + PER));
  return v_flex().flex_none().gap(2).children(rows.map((line) => h_flex().gap(2).children(line.map((name) => {
    const on = name === selected;
    return div().id(`${id}-${name ?? "initiale"}`).size(34).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
      .tooltip(name ?? "Initiale")
      .when(on, (el) => el.bg(t.selected).border_1().border_color(color))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { onPick(name); cx.notify(); })
      .child(name === null
        ? div().text_size(14).font_bold().text_color(on ? color : t.muted).child(initial)
        : svg(icon(name)).size(16).text_color(on ? color : t.muted));
  }))));
}

// Une ligne de menu.
function item(t, id, it, selected, onClick) {
  return h_flex().id(id).h(30).pr(8).pl(8 + (it.indent ?? 0) * 16).gap(9).rounded(7).items_center().flex_none()
    .text_color(it.disabled ? t.dim : it.danger ? t.blocked : t.foreground)
    .when(selected && !it.disabled, (el) => el.bg(t.selected))
    .when(!it.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
    .child(it.swatch
      ? div().size(14).flex_none().flex().items_center().justify_center().child(svg(it.icon).size(14).text_color(it.swatch))
      : svg(it.icon).size(14).flex_none().text_color(it.danger ? t.blocked : t.muted))
    .child(div().flex_1().min_w(0).truncate().child(it.label))
    .when(Boolean(it.hint), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint)));
}

// Une liste de lignes au clavier : ↑/↓, Entrée, Échap.
class ListPopup {
  init(cx) {
    this.p = props() ?? {};
    this.at = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {}

  choose(it) {
    if (!it || it.disabled || it.title) return;
    closeOverlay(this.p.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const list = this.items();
    const usable = list.map((it, i) => (it.disabled || it.title ? -1 : i)).filter((i) => i !== -1);
    return v_flex().id("sv-list").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        const k = usable.indexOf(this.at);
        if (e.key === "down") this.at = usable[(k + 1) % usable.length] ?? -1;
        else if (e.key === "up") this.at = usable[(k + usable.length - 1) % usable.length] ?? -1;
        else if (e.key === "enter") this.choose(list[this.at]);
        else if (e.key === "escape") closeOverlay(this.p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => it.title
        ? div().h(24).px(8).flex_none().flex().items_center().text_size(11).text_color(t.dim).child(it.title)
        : v_flex().flex_none()
          .when(Boolean(it.sep), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(item(t, `sv-it-${i}`, it, i === this.at, () => this.choose(it)))));
  }
}

export class MenuView extends ListPopup {
  init(cx) {
    super.init(cx);
    this.git = null;
    if (this.p.of === "space") {
      const s = spaces().find((x) => x.id === this.p.id);
      const folder = s && place(s);
      if (folder) cx.spawn(async (cx) => { this.git = await checkout(folder, s.machine).catch(() => null); cx.notify(); });
    }
  }

  items() {
    const d = data();
    const id = this.p.id;
    if (this.p.of === "group") {
      const g = d.groups[id];
      if (!g) return [{ title: "Ce groupe n'existe plus" }];
      const deep = A.depthOf(d, id) >= A.MAX_DEPTH;
      return [
        { label: "Nouveau space ici…", icon: chrome("plus"), act: () => openView("machines", { group: id }) },
        { label: "Nouveau sous-groupe…", icon: chrome("folder-plus"), disabled: deep, hint: deep ? "8 niveaux" : "", act: () => openView("group", { parent: id }) },
        { label: "Modifier le groupe…", icon: chrome("square-pen"), act: () => openView("group", { id }) },
        { label: g.folded ? "Déplier" : "Replier", icon: chrome(g.folded ? "chevron-down" : "chevron-right"), act: () => save(A.setFolded(d, id, !g.folded)) },
        ...(!g.parent && d.after[id] ? [{ label: "Mettre en haut de la liste", icon: chrome("pin"),
          act: () => { let x = A.placeAfter(data(), id, []); const first = x.children.root[0]; if (first && first !== A.ref("g", id)) x = A.moveGroup(x, id, { into: null, before: first }); save(x); } }] : []),
        ...(g.parent ? [{ label: "Remonter d'un niveau", icon: chrome("chevron-left"), act: () => save(A.moveGroup(d, id, { into: d.groups[g.parent]?.parent ?? null, after: A.ref("g", g.parent) })) }] : []),
        { label: "Dégrouper", icon: chrome("x"), sep: true, danger: true, act: () => save(A.removeGroup(d, id)) },
      ];
    }
    if (this.p.of === "tab") {
      const s = spaces().find((x) => (x.tabs ?? []).some((c) => c.id === id));
      if (!s) return [{ title: "Ce terminal n'existe plus" }];
      return [
        { label: "Étiquettes…", icon: icon("tag"), act: () => openView("labels", { tab: id }) },
        { label: "Renommer", icon: chrome("square-pen"), act: () => run("tab.rename", { id }) },
        { label: "Déplacer vers un space…", icon: icon("folder-open"), disabled: !targetsFor(id).length,
          hint: targetsFor(id).length ? "" : "aucun autre space ici", act: () => openView("movetab", { tab: id }) },
        { label: "Nouvel onglet dans ce space", icon: chrome("plus"), act: () => run("tab.new", { space: s.id }) },
        { label: "Fermer", icon: chrome("x"), sep: true, act: () => run("tab.close", { id }) },
      ];
    }
    if (this.p.of === "header") {
      const all = Object.values(d.groups);
      const by = Boolean(shared(OPTIONS)?.byMachine);
      return [
        { label: "Trier par machine", icon: chrome("server"), hint: by ? "\u2713" : "",
          act: () => setShared(OPTIONS, { ...(shared(OPTIONS) ?? {}), byMachine: !by }) },
        { label: "Nouveau groupe…", icon: chrome("folder-plus"), sep: true, act: () => openView("group", {}) },
        { label: "Gérer les étiquettes…", icon: icon("tag"), act: () => openView("labels", {}) },
        ...(all.length ? [
          { label: "Tout replier", icon: chrome("chevron-right"), sep: true, act: () => { const x = data(); for (const g of Object.values(x.groups)) g.folded = true; save(x); } },
          { label: "Tout déplier", icon: chrome("chevron-down"), act: () => { const x = data(); for (const g of Object.values(x.groups)) g.folded = false; save(x); } },
        ] : []),
      ];
    }
    const grouped = A.groupOfSpace(d, id);
    return [
      { label: "Icône et couleur…", icon: icon("palette"), act: () => openView("look", { space: id }) },
      { label: "Déplacer vers un groupe…", icon: icon("folder-open"), act: () => openView("move", { space: id }) },
      { label: "Nouveau groupe avec ce space…", icon: chrome("folder-plus"), act: () => openView("group", { withSpace: id }) },
      ...(grouped ? [{ label: "Retirer du groupe", icon: chrome("minus"), act: () => save(A.moveSpace(d, id, { into: null })) }] : []),
      { label: "Renommer", icon: chrome("square-pen"), sep: true, act: () => run("space.rename", { id }) },
      ...(this.git ? [
        { label: "Nouveau worktree", icon: chrome("git-branch"), act: () => worktree({ space: id, action: "new" }) },
        { label: "Ouvrir un worktree", icon: chrome("git-branch"), act: () => worktree({ space: id, action: "open" }) },
      ] : []),
      ...(this.git === "linked" ? [{ label: "Retirer le worktree", icon: chrome("git-branch"), act: () => worktree({ space: id, action: "remove" }) }] : []),
      { label: "Fermer", icon: chrome("x"), sep: true, act: () => run("space.close", { id }) },
    ];
  }
}

export class MachinesView extends ListPopup {
  start(m) {
    if (this.p.group) setShared(PENDING, { group: this.p.group, machine: m, before: spaces().map((s) => s.id), at: Date.now() });
    run("space.new", { machine: m ?? "" });
  }

  items() {
    const d = data();
    const g = this.p.group && d.groups[this.p.group];
    const out = [{ title: g ? `Nouveau space dans « ${g.name} », sur…` : "Nouveau space sur…" }];
    for (const m of machineList()) {
      const down = m.layout === "unavailable";
      out.push({ label: m.name ?? "Cet ordinateur", icon: chrome(m.name ? "server" : "monitor"), disabled: down,
        hint: down ? "injoignable" : m.layout === "loading" ? "connexion…" : "", act: () => this.start(m.name) });
    }
    if (!g) out.push({ label: "Nouveau groupe…", icon: chrome("folder-plus"), sep: true, act: () => openView("group", {}) });
    return out;
  }
}

export class MoveView extends ListPopup {
  items() {
    const d = data();
    const sid = this.p.space;
    const now = A.groupOfSpace(d, sid);
    const out = [{ title: "Déplacer vers…" },
      { label: "Aucun groupe (sous sa machine)", icon: now ? chrome("minus") : chrome("check"), act: () => save(A.moveSpace(data(), sid, { into: null })) }];
    const walk = (gid, depth) => {
      const g = d.groups[gid];
      if (!g) return;
      out.push({ label: g.name, indent: depth, icon: icon(g.icon), swatch: A.colorOf(d, gid), hint: gid === now ? "✓" : "",
        act: () => { let x = A.moveSpace(data(), sid, { into: gid }); x = A.setFolded(x, gid, false); save(x); } });
      for (const r of d.children[gid] ?? []) { const k = A.unref(r); if (k.kind === "g") walk(k.id, depth + 1); }
    };
    for (const r of d.children.root) walk(A.unref(r).id, 0);
    out.push({ label: "Nouveau groupe…", icon: chrome("folder-plus"), sep: true, act: () => openView("group", { withSpace: sid }) });
    return out;
  }
}

// Les spaces où un onglet peut aller : ceux de sa machine. Le choix est relayé à la barre (MOVE_TAB),
// qui fait le déplacement : cet overlay se ferme avant la fin.
export class MoveTabView extends ListPopup {
  items() {
    const d = data();
    const tab = this.p.tab;
    const list = targetsFor(tab);
    const out = [{ title: "Déplacer l'onglet vers…" }];
    if (!list.length) out.push({ label: "Aucun autre space sur cette machine", icon: chrome("minus"), disabled: true });
    for (const s of list) {
      const g = A.groupOfSpace(d, s.id);
      out.push({ label: s.name, icon: chrome(s.machine ? "server" : "monitor"), swatch: avatarColor(theme(), s, d),
        hint: g ? d.groups[g]?.name ?? "" : "",
        act: () => { setShared(MOVE_TAB, { tab, to: s.id, at: Date.now() }); run("spaces-virgile.movetab"); } });
    }
    return out;
  }
}

// Les étiquettes : cocher celles d'un space, en créer, les renommer, les recolorer, les supprimer.
export class LabelsView {
  init(cx) {
    this.p = props() ?? {};
    this.editing = null; // lid en cours de modification, ou null (nouvelle)
    this.confirm = null; // lid dont la suppression attend un second clic
    this.color = A.PALETTE[(data().labelOrder.length * 5) % A.PALETTE.length];
    this.error = "";
    this.name = InputState.new({ placeholder: "Nom de l'étiquette" });
    this.hexIn = InputState.new({ placeholder: "#3e63dd", value: this.color });
    this.name.on("submit", (_e, cx) => { this.submit(); cx.notify(); });
    this.name.on("change", (_e, cx) => { if (this.error) { this.error = ""; cx.notify(); } });
    this.name.on("focus", (_e, cx) => { this.nameFocused = true; cx.notify(); });
    this.name.on("blur", (_e, cx) => { this.nameFocused = false; cx.notify(); });
    this.hexIn.on("change", (_e, cx) => { const c = A.hex(this.hexIn.value()); if (c) this.color = c; cx.notify(); });
    this.hexIn.on("submit", (_e, cx) => { this.submit(); cx.notify(); });
    this.hexIn.on("focus", (_e, cx) => { this.hexFocused = true; cx.notify(); });
    this.hexIn.on("blur", (_e, cx) => { this.hexFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    this.name.focus();
    cx.timer.after(150, () => this.name.focus());
  }

  close() { this.name.release(); this.hexIn.release(); }

  pick(c) { this.color = c; this.hexIn.set_value(c); }

  edit(lid) {
    const l = data().labels[lid];
    if (!l) return;
    this.editing = lid;
    this.confirm = null;
    this.name.set_value(l.name);
    this.pick(l.color);
    this.name.focus();
  }

  reset() {
    this.editing = null;
    this.name.set_value("");
    this.error = "";
  }

  submit() {
    const name = this.name.value().trim();
    if (!name) { this.error = "Il faut un nom."; return; }
    const color = A.hex(this.hexIn.value()) ?? this.color;
    let d = data();
    const taken = d.labelOrder.find((l) => l !== this.editing && d.labels[l].name.toLowerCase() === name.toLowerCase());
    if (taken) { this.error = "Une étiquette porte déjà ce nom."; return; }
    if (this.editing) d = A.editLabel(d, this.editing, { name, color });
    else {
      let lid;
      [d, lid] = A.addLabel(d, { name, color });
      if (lid && this.p.tab) d = A.toggleTag(d, this.p.tab, lid);
    }
    save(d);
    this.reset();
    this.color = A.PALETTE[(data().labelOrder.length * 5) % A.PALETTE.length];
    this.hexIn.set_value(this.color);
  }

  render() {
    const t = theme();
    const d = data();
    // Les étiquettes se posent sur un terminal (un onglet), pas sur un space.
    const sid = this.p.tab;
    const tab = sid ? spaces().flatMap((s) => s.tabs ?? []).find((c) => c.id === sid) : null;
    const mine = new Set(sid ? d.tags[sid] ?? [] : []);
    const close = () => closeOverlay(this.p.overlay);
    const rows = d.labelOrder.map((lid, i) => {
      const l = d.labels[lid];
      const on = mine.has(lid);
      const used = Object.values(d.tags).filter((x) => x.includes(lid)).length;
      return h_flex().id(`lb-${i}`).h(32).px(8).gap(9).flex_none().items_center().rounded(7)
        .when(this.editing === lid, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .when(Boolean(sid), (el) => el.cursor_pointer().on_click((_e, cx) => { save(A.toggleTag(data(), sid, lid)); cx.notify(); })
          .child(div().size(16).flex_none().rounded(4).border_1().border_color(on ? l.color : t.input).bg(on ? l.color : "#00000000")
            .flex().items_center().justify_center().when(on, (b) => b.child(svg(chrome("check")).size(11).text_color("#ffffff")))))
        .child(div().size(9).rounded(5).flex_none().bg(l.color))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(l.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(used ? `${used} terminal${used > 1 ? "aux" : ""}`.replace("terminalaux", "terminaux") : ""))
        .child(div().id(`lb-ed-${i}`).size(22).flex_none().rounded(5).flex().items_center().justify_center().cursor_pointer()
          .tooltip("Modifier").hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); this.edit(lid); cx.notify(); })
          .child(svg(chrome("square-pen")).size(13).text_color(t.muted)))
        .child(div().id(`lb-rm-${i}`).h(22).flex_none().rounded(5).when(this.confirm === lid, (el) => el.px(6)).when(this.confirm !== lid, (el) => el.w(22))
          .flex().items_center().justify_center().cursor_pointer()
          .tooltip(this.confirm === lid ? "Cliquer encore pour supprimer partout" : "Supprimer").hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (this.confirm === lid) { save(A.removeLabel(data(), lid)); this.confirm = null; if (this.editing === lid) this.reset(); }
            else this.confirm = lid;
            cx.notify();
          })
          .child(this.confirm === lid ? div().text_size(11).text_color(t.blocked).child("Supprimer ?") : svg(chrome("x")).size(13).text_color(t.muted)));
    });
    return v_flex().id("sv-labels").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Étiquettes"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().pt(2).pb(12).text_size(11.5).text_color(t.dim).truncate()
        .child(tab ? `Cochez celles de « ${tabTitle(tab)} ».` : "Les étiquettes servent à tous les terminaux."))
      .child(v_flex().id("lb-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(rows.length ? rows : [div().py(10).text_size(12).text_color(t.dim).child("Aucune étiquette pour l'instant : créez-en une ci-dessous.")]))
      .child(div().flex_none().my(12).h(1).bg(t.border))
      .child(label(t, this.editing ? `Modifier « ${d.labels[this.editing]?.name ?? ""} »` : "Nouvelle étiquette"))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().size(12).rounded(6).flex_none().bg(this.color))
        .child(field(t, this.name, this.nameFocused, Boolean(this.error)).flex_1()))
      .child(div().flex_none().h(10))
      .child(colorPicker(t, "lb", this.color, this.hexIn, this.hexFocused, (c) => this.pick(c)))
      .child(h_flex().flex_none().pt(16).gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.error))
        .when(Boolean(this.editing), (el) => el.child(button(t, "lb-cancel", "Annuler", false, (_e, cx) => { this.reset(); cx.notify(); })))
        .child(button(t, "lb-save", this.editing ? "Enregistrer" : sid ? "Créer et cocher" : "Créer", false, (_e, cx) => { this.submit(); cx.notify(); }))
        .child(button(t, "lb-close", "Fermer", true, close)));
  }
}

// Nouveau groupe / Modifier le groupe : nom, icône, et couleur pour un groupe racine
// (un sous-groupe prend celle de son groupe racine).
export class GroupView {
  init(cx) {
    this.p = props() ?? {};
    const d = data();
    const g = this.p.id ? d.groups[this.p.id] : null;
    this.g = g;
    this.parent = g ? g.parent : this.p.parent ?? null;
    this.icon = g?.icon ?? "folder";
    this.color = g?.color ?? A.PALETTE[(Object.keys(d.groups).length * 5 + 6) % A.PALETTE.length];
    this.error = "";
    // Les spaces qui entrent dans le nouveau groupe : un (withSpace) ou deux (withSpaces, un glisser).
    this.withs = this.p.withSpaces ?? (this.p.withSpace ? [this.p.withSpace] : []);
    const value = g?.name ?? this.p.name ?? "";
    this.name = InputState.new({ placeholder: "Nom du groupe", value });
    this.hexIn = InputState.new({ placeholder: "#3e63dd", value: this.color });
    this.name.on("submit", (_e, cx) => { this.save(); cx.notify(); });
    this.name.on("change", (_e, cx) => { if (this.error) { this.error = ""; cx.notify(); } });
    this.name.on("focus", (_e, cx) => { this.nameFocused = true; cx.notify(); });
    this.name.on("blur", (_e, cx) => { this.nameFocused = false; cx.notify(); });
    this.hexIn.on("change", (_e, cx) => { const c = A.hex(this.hexIn.value()); if (c) this.color = c; cx.notify(); });
    this.hexIn.on("focus", (_e, cx) => { this.hexFocused = true; cx.notify(); });
    this.hexIn.on("blur", (_e, cx) => { this.hexFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    const focus = () => { this.name.focus(); this.name.set_selected_range({ start: 0, end: value.length }); };
    focus();
    cx.timer.after(150, focus);
  }

  close() { this.name.release(); this.hexIn.release(); }

  save() {
    const name = this.name.value().trim();
    if (!name) { this.error = "Il faut un nom."; return; }
    const color = A.hex(this.hexIn.value()) ?? this.color;
    let d = data();
    if (this.g) {
      if (!d.groups[this.p.id]) return closeOverlay(this.p.overlay);
      d = A.editGroup(d, this.p.id, { name, icon: this.icon, color });
    } else {
      // Avec un space : le groupe se crée là où est le (premier) space (dans son groupe, sinon à la racine).
      const first = this.withs[0];
      const parent = first ? A.groupOfSpace(d, first) : this.parent;
      const after = first && parent ? A.ref("s", first) : null;
      let gid;
      [d, gid] = A.addGroup(d, { name, icon: this.icon, color, parent, after });
      if (!gid) { this.error = "Pas plus de 8 niveaux."; return; }
      if (parent) d = A.setFolded(d, parent, false);
      for (const sid of this.withs) d = A.moveSpace(d, sid, { into: gid });
    }
    save(d);
    closeOverlay(this.p.overlay);
  }

  render() {
    const t = theme();
    const d = data();
    const close = () => closeOverlay(this.p.overlay);
    const parent = this.withs[0] ? A.groupOfSpace(d, this.withs[0]) : this.parent;
    const inherited = parent ? A.colorOf(d, parent) : null;
    const pair = this.withs.length > 1 ? this.withs.map((sid) => spaces().find((s) => s.id === sid)).filter(Boolean) : [];
    const shown = inherited ?? this.color;
    return v_flex().id("sv-group").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(this.g ? "Modifier le groupe" : pair.length ? "Grouper ces deux spaces" : parent ? "Nouveau sous-groupe" : "Nouveau groupe"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(pair.length > 0, (el) => el.child(div().flex_none().pt(6).text_size(12).text_color(t.muted)
        .child(`${pair.map((s) => `« ${s.name} » (${s.machine ?? "cet ordinateur"})`).join(" et ")}. Un space reste sur sa machine : le groupe les montre ensemble.`)))
      .child(div().flex_none().h(14))
      .child(label(t, "Nom"))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(h_flex().size(34).flex_none().rounded(8).border_1().border_color(t.input).bg(t.background).items_center().justify_center()
          .child(svg(icon(this.icon)).size(17).text_color(shown)))
        .child(field(t, this.name, this.nameFocused, Boolean(this.error)).flex_1()))
      .child(div().flex_none().h(14))
      .child(label(t, "Icône"))
      .child(iconGrid(t, "ic", this.icon, shown, (name) => { this.icon = name; }))
      .child(div().flex_none().h(14))
      .child(label(t, "Couleur"))
      .child(inherited
        ? h_flex().flex_none().gap(8).items_center()
          .child(div().size(24).rounded(12).flex_none().bg(inherited))
          .child(div().text_size(12).text_color(t.dim).child(`Héritée de « ${d.groups[A.rootOf(d, parent)]?.name ?? ""} » (les sous-groupes prennent la couleur de leur groupe racine).`))
        : colorPicker(t, "gr", this.color, this.hexIn, this.hexFocused, (c) => { this.color = c; this.hexIn.set_value(c); }))
      .child(div().flex_1())
      .child(h_flex().flex_none().pt(16).gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.error))
        .child(button(t, "gr-cancel", "Annuler", false, close))
        .child(button(t, "gr-save", this.g ? "Enregistrer" : "Créer", true, (_e, cx) => { this.save(); cx.notify(); })));
  }
}

// L'avatar d'un space : une icône ou son initiale, et sa couleur. La couleur va aussi dans
// shared "space.colors", que lisent les autres mods qui dessinent les avatars.
export class LookView {
  init(cx) {
    this.p = props() ?? {};
    const d = data();
    const w = spaces().find((s) => s.id === this.p.space);
    const look = d.looks[this.p.space];
    this.icon = look?.icon ?? null;
    this.color = look?.color ?? (w ? avatarColor(theme(), w, d) : A.PALETTE[6]);
    this.hexIn = InputState.new({ placeholder: "#3e63dd", value: this.color });
    this.hexIn.on("change", (_e, cx) => { const c = A.hex(this.hexIn.value()); if (c) this.color = c; cx.notify(); });
    this.hexIn.on("submit", (_e, cx) => { this.save(); cx.notify(); });
    this.hexIn.on("focus", (_e, cx) => { this.hexFocused = true; cx.notify(); });
    this.hexIn.on("blur", (_e, cx) => { this.hexFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() { this.hexIn.release(); }

  save() {
    const sid = this.p.space;
    const color = A.hex(this.hexIn.value()) ?? this.color;
    save(A.setLook(data(), sid, { icon: this.icon, color }));
    setShared("space.colors", { ...(shared("space.colors") ?? {}), [sid]: color });
    closeOverlay(this.p.overlay);
  }

  // Ce que Herdr montre de lui-même : l'initiale, et une couleur qu'il redonne.
  reset() {
    const sid = this.p.space;
    save(A.setLook(data(), sid, null));
    const colors = { ...(shared("space.colors") ?? {}) };
    if (String(colors[sid] ?? "").startsWith("#")) { delete colors[sid]; setShared("space.colors", colors); }
    closeOverlay(this.p.overlay);
  }

  render() {
    const t = theme();
    const d = data();
    const close = () => closeOverlay(this.p.overlay);
    const w = spaces().find((s) => s.id === this.p.space);
    if (!w) return v_flex().size_full().p(18).bg(t.popover).text_color(t.dim).child("Ce space n'existe plus.");
    const letter = [...w.name][0]?.toUpperCase() ?? "?";
    return v_flex().id("sv-look").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Icône du space"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_none().pt(14).gap(10).items_center()
        .child(avatar(t, w, d, 34, { icon: this.icon, color: this.color }))
        .child(div().flex_1().min_w(0).truncate().text_size(13.5).child(w.name)))
      .child(div().flex_none().h(14))
      .child(label(t, "Icône"))
      .child(iconGrid(t, "lk", this.icon, this.color, (name) => { this.icon = name; }, letter))
      .child(div().flex_none().h(14))
      .child(label(t, "Couleur"))
      .child(colorPicker(t, "lk", this.color, this.hexIn, this.hexFocused, (c) => { this.color = c; this.hexIn.set_value(c); }))
      .child(div().flex_1())
      .child(h_flex().flex_none().pt(16).gap(8).items_center()
        .when(Boolean(d.looks[w.id]), (el) => el.child(button(t, "lk-reset", "Remettre celle de Herdr", false, () => this.reset())))
        .child(div().flex_1())
        .child(button(t, "lk-cancel", "Annuler", false, close))
        .child(button(t, "lk-save", "Enregistrer", true, (_e, cx) => { this.save(); cx.notify(); })));
  }
}

export const VIEWS = { menu: MenuView, machines: MachinesView, move: MoveView, movetab: MoveTabView, labels: LabelsView, group: GroupView, look: LookView };

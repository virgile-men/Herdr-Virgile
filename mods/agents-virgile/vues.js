// Les popups et dialogues de la liste Agents de Herdr-Virgile, ouverts par etat.js openView : ce même
// mod en overlay, avec props { view, ... } (main.js choisit la classe d'après view).
//   menu      { of: "agent" | "group" | "header", id }   le clic droit, et le ☰ de l'en-tête
//   sort      {}                                         l'icône de tri : Priority / Grouped by space
//   move      { agent }                                  Déplacer vers un groupe
//   group     { id? | parent? | withAgent? }             Nouveau groupe / Modifier le groupe
//   auto      {}                                         Ranger automatiquement : jamais, ou après N jours au repos
//   kanban    {}                                         la vue kanban (kanban.js)
// Les petites pièces (boutons, champs, couleurs, icônes, listes au clavier) sont copiées de
// mods/spaces-virgile/vues.js.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, run, terminals, shared } from "herdr";
import * as A from "./arbre.js";
import { data, save, openView, icon, chrome, allAgents, openArgs, SORTS, sortOf, setSort, isFolded, setFolded, AUTO_DAYS, autoDays, setAutoDays, settleArgs, listHeight } from "./etat.js";

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
    return v_flex().id("av-list").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
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
          .child(item(t, `av-it-${i}`, it, i === this.at, () => this.choose(it)))));
  }
}

export class MenuView extends ListPopup {
  items() {
    const d = data();
    const id = this.p.id;
    if (this.p.of === "group") {
      const g = d.groups[id];
      if (!g) return [{ title: "Ce groupe n'existe plus" }];
      const deep = A.depthOf(d, id) >= A.MAX_DEPTH;
      return [
        { label: "Nouveau sous-groupe…", icon: chrome("folder-plus"), disabled: deep, hint: deep ? "8 niveaux" : "", act: () => openView("group", { parent: id }) },
        { label: "Modifier le groupe…", icon: chrome("square-pen"), act: () => openView("group", { id }) },
        { label: g.folded ? "Déplier" : "Replier", icon: chrome(g.folded ? "chevron-down" : "chevron-right"), act: () => save(A.setFolded(d, id, !g.folded)) },
        ...(g.parent ? [{ label: "Remonter d'un niveau", icon: chrome("chevron-left"), act: () => save(A.moveGroup(d, id, { into: d.groups[g.parent]?.parent ?? null, after: A.ref("g", g.parent) })) }] : []),
        { label: "Dégrouper", icon: chrome("x"), sep: true, danger: true, act: () => save(A.removeGroup(d, id)) },
      ];
    }
    if (this.p.of === "header") {
      const on = sortOf().id;
      const all = Object.values(d.groups);
      // Autant de lignes que etat.js headerMenuHeight en compte.
      const whole = isFolded();
      return [
        { label: "Vue kanban", icon: icon("square-kanban"), act: () => openView("kanban", {}) },
        { label: "Ranger automatiquement…", icon: chrome("archive"), hint: autoDays() ? `après ${autoDays()} j` : "jamais", act: () => openView("auto", {}, null, listHeight(AUTO_DAYS.length, 1)) },
        { label: whole ? "Déplier la liste" : "Replier la liste", icon: icon(whole ? "chevrons-up-down" : "chevrons-down-up"), hint: whole ? "" : "en-tête seul", act: () => setFolded(!whole) },
        { title: "Trier les agents hors groupe" },
        ...SORTS.map((s) => ({ label: s.label === "Priority" ? "Par priorité" : "Par space", icon: chrome(s.icon), hint: s.id === on ? "\u2713" : "", act: () => setSort(s.id) })),
        { label: "Nouveau groupe…", icon: chrome("folder-plus"), sep: true, act: () => openView("group", {}) },
        ...(all.length ? [
          { label: "Replier les groupes", icon: chrome("chevron-right"), act: () => { const x = data(); for (const g of Object.values(x.groups)) g.folded = true; save(x); } },
          { label: "Déplier les groupes", icon: chrome("chevron-down"), act: () => { const x = data(); for (const g of Object.values(x.groups)) g.folded = false; save(x); } },
        ] : []),
      ];
    }
    const a = allAgents().find((x) => x.address === id);
    const k = terminals().find((x) => x.address === id && x.state === "live");
    if (!a && !k) return [{ title: "Cet agent n'existe plus" }];
    const pinned = Boolean(k?.labels?.["herdr.pinned"]);
    const grouped = A.groupOfAgent(d, id);
    return [
      ...(a ? [{ label: "Ouvrir", icon: chrome("terminal"), act: () => run(...openArgs(a)) }] : []),
      { label: "Aperçu du terminal", icon: icon("eye"), act: () => run("terminal.peek", { terminal: id }) },
      { label: pinned ? "Désépingler" : "Épingler en haut", icon: icon(pinned ? "pin-off" : "pin"), act: () => run("terminal.pin", { terminal: id, pinned: !pinned }) },
      // Ranger son onglet (tab.settle : tout l'onglet, il tourne toujours), ou l'en sortir.
      a?.tab
        ? { label: a.settled ? "Sortir des rangés" : "Ranger son onglet", icon: icon(a.settled ? "archive-restore" : "archive"), act: () => run(...settleArgs(a, !a.settled)) }
        : { label: "Ranger son onglet", icon: icon("archive"), disabled: true, hint: "sans onglet" },
      { label: "Déplacer vers un groupe…", icon: icon("folder-open"), sep: true, act: () => openView("move", { agent: id }) },
      { label: "Nouveau groupe avec cet agent…", icon: chrome("folder-plus"), act: () => openView("group", { withAgent: id }) },
      ...(grouped ? [{ label: "Retirer du groupe", icon: chrome("minus"), act: () => save(A.moveAgent(d, id, { into: null })) }] : []),
      { label: "Vue kanban", icon: icon("square-kanban"), sep: true, act: () => openView("kanban", { focus: id }) },
    ];
  }
}

// L'icône de tri de l'en-tête (le menu du mod livré).
export class SortView extends ListPopup {
  items() {
    const on = sortOf().id;
    return [{ title: "Sort agents" }, ...SORTS.map((s) => ({ label: s.label, icon: chrome(s.icon), hint: s.id === on ? "\u2713" : "", act: () => setSort(s.id) }))];
  }
}

export class MoveView extends ListPopup {
  items() {
    const d = data();
    const id = this.p.agent;
    const now = A.groupOfAgent(d, id);
    const out = [{ title: "Déplacer vers…" },
      { label: "Aucun groupe", icon: now ? chrome("minus") : chrome("check"), act: () => save(A.moveAgent(data(), id, { into: null })) }];
    const walk = (gid, depth) => {
      const g = d.groups[gid];
      if (!g) return;
      out.push({ label: g.name, indent: depth, icon: icon(g.icon), swatch: A.colorOf(d, gid), hint: gid === now ? "\u2713" : "",
        act: () => { let x = A.moveAgent(data(), id, { into: gid }); x = A.setFolded(x, gid, false); save(x); } });
      for (const r of d.children[gid] ?? []) { const k = A.unref(r); if (k.kind === "g") walk(k.id, depth + 1); }
    };
    for (const r of d.children.root) walk(A.unref(r).id, 0);
    out.push({ label: "Nouveau groupe…", icon: chrome("folder-plus"), sep: true, act: () => openView("group", { withAgent: id }) });
    return out;
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
    const value = g?.name ?? "";
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
      // Avec un agent : le groupe se crée là où est l'agent (dans son groupe, sinon à la racine).
      const parent = this.p.withAgent ? A.groupOfAgent(d, this.p.withAgent) : this.parent;
      const after = this.p.withAgent && parent ? A.ref("s", this.p.withAgent) : null;
      let gid;
      [d, gid] = A.addGroup(d, { name, icon: this.icon, color, parent, after });
      if (!gid) { this.error = "Pas plus de 8 niveaux."; return; }
      if (parent) d = A.setFolded(d, parent, false);
      if (this.p.withAgent) d = A.moveAgent(d, this.p.withAgent, { into: gid });
    }
    save(d);
    closeOverlay(this.p.overlay);
  }

  render() {
    const t = theme();
    const d = data();
    const close = () => closeOverlay(this.p.overlay);
    const parent = this.p.withAgent ? A.groupOfAgent(d, this.p.withAgent) : this.parent;
    const inherited = parent ? A.colorOf(d, parent) : null;
    const shown = inherited ?? this.color;
    return v_flex().id("av-group").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(this.g ? "Modifier le groupe" : parent ? "Nouveau sous-groupe" : "Nouveau groupe"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
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


// Ranger automatiquement les onglets dont les agents sont au repos depuis N jours (etat.js AUTO_DAYS).
export class AutoView extends ListPopup {
  items() {
    const on = autoDays();
    return [{ title: "Ranger les onglets au repos depuis…" },
      ...AUTO_DAYS.map((v) => ({ label: v ? `${v} jour${v > 1 ? "s" : ""}` : "Jamais", icon: v ? chrome("clock") : chrome("x"), hint: v === on ? "\u2713" : "", act: () => setAutoDays(v) }))];
  }
}

export const VIEWS = { menu: MenuView, sort: SortView, move: MoveView, group: GroupView, auto: AutoView };

// L'état partagé des étiquettes et groupes (arbre.js), et l'ouverture des popups de ce mod.

import { svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, openOverlay, panes, terminals } from "herdr";
import { KEY, normalize } from "./arbre.js";

export const data = () => normalize(shared(KEY));
export const save = (d) => setShared(KEY, d);

// Un space demandé depuis un groupe (« Nouveau space ici ») : { group, machine, before: [ids], at }.
// La barre le range dans le groupe dès qu'il apparaît (main.js, checkNew).
export const PENDING = "spaces-virgile.pending";

// Les réglages de la barre (menu ☰ de l'en-tête) : { byMachine } = les spaces hors groupe sous un
// en-tête par machine (sinon une seule liste, l'ordre de Herdr).
export const OPTIONS = "spaces-virgile.options";

// Où est un élément dans la fenêtre, d'après un clic dessus.
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

export const SIZES = {
  menu: { kind: "popup", width: 268, height: 380 },
  machines: { kind: "popup", width: 250, height: 380 },
  move: { kind: "popup", width: 260, height: 400 },
  labels: { kind: "dialog", width: 440, height: 560 },
  group: { kind: "dialog", width: 452, height: 590 },
  look: { kind: "dialog", width: 452, height: 540 },
};

// `at` : un point de la fenêtre, ou rien (le pointeur ; un dialogue est centré).
export function openView(view, p = {}, at = null) {
  const s = SIZES[view];
  return openOverlay({ mod: "spaces-virgile", ...s, ...(at && s.kind === "popup" ? { at } : {}), props: { view, ...p } });
}

export const icon = (name) => `mods/spaces-virgile/icons/${name}.svg`;
export const chrome = (name) => `mods/workspace-chrome/${name}.svg`;

// Une couleur d'avatar rangée par nom (dans shared "space.colors", comme le fait Herdr) :
// une couleur franche par teinte, en clair comme en sombre (la table du mod livré).
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// La couleur de l'avatar d'un space : la sienne (looks), sinon celle que Herdr lui a donnée.
export function avatarColor(t, w, d) {
  const mine = d.looks[w.id]?.color;
  if (mine) return mine;
  const c = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

// L'avatar d'un space : une tuile de sa couleur, avec son icône (looks) ou son initiale.
// `look` : un aperçu (le dialogue Icône du space), sinon celui qui est rangé.
export function avatar(t, w, d, size = 18, look = null) {
  const l = look ?? d.looks[w.id] ?? {};
  const fill = look?.color ?? avatarColor(t, w, d);
  const tile = h_flex().size(size).flex_none().rounded(Math.round(size * 5 / 18)).bg(fill).items_center().justify_center();
  return l.icon
    ? tile.child(svg(icon(l.icon)).size(Math.round(size * 0.64)).text_color("#ffffff"))
    : tile.text_size(size * 10.5 / 18).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?");
}

// Le nom d'un onglet : le sien, sinon le programme qu'il montre (comme la barre d'onglets).
export function tabTitle(c, ps = panes()) {
  if (c.named) return c.name;
  const program = ps.find((p) => p.tab === c.id && p.program?.agent)?.program ?? ps.find((p) => p.tab === c.id)?.program;
  return program?.name ?? "Terminal";
}

const short = (x) => String(x ?? "").split("/").pop();

// Les terminaux d'un onglet : ceux de ses volets, et celui qu'un volet de chat (Trace) cache
// derrière lui (le terminal étiqueté herdr.chat=<volet>). { address (sans machine), cwd }.
export function tabTerminals(c, ps = panes(), ts = terminals()) {
  const out = [];
  for (const p of ps) {
    if (p.tab !== c.id) continue;
    if (p.terminal) out.push({ address: short(p.terminal), cwd: p.cwd });
    else {
      const k = ts.find((k) => k.state === "live" && k.labels?.["herdr.chat"] && short(k.labels["herdr.chat"]) === short(p.pane));
      if (k) out.push({ address: short(k.address), cwd: k.cwd ?? k.foreground?.cwd ?? null });
    }
  }
  return out;
}

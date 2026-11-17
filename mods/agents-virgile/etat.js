// L'état partagé des groupes d'agents (arbre.js), la liste des agents et ce que la barre, les menus
// et le kanban dessinent tous pareil.

import { svg, image, div } from "gpui-kit";
import { shared, setShared, openOverlay, agents, terminals, panes, spaces, focused } from "herdr";
import { KEY, normalize } from "./arbre.js";

export const data = () => normalize(shared(KEY));
export const save = (d) => setShared(KEY, d);

// Où est un élément dans la fenêtre, d'après un clic dessus.
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

export const SIZES = {
  menu: { kind: "popup", width: 268, height: 380 },
  sort: { kind: "popup", width: 220, height: 120 },
  move: { kind: "popup", width: 260, height: 400 },
  group: { kind: "dialog", width: 452, height: 590 },
  kanban: { kind: "dialog", width: 1400, height: 860 },
};

// `at` : un point de la fenêtre, ou rien (le pointeur ; un dialogue est centré). `height` : celle
// d'un menu qui sait combien il a de lignes.
export function openView(view, p = {}, at = null, height = null) {
  const s = { ...SIZES[view], ...(height ? { height } : {}) };
  return openOverlay({ mod: "agents-virgile", ...s, ...(at && s.kind === "popup" ? { at } : {}), props: { view, ...p } });
}

// La hauteur d'une liste de vues.js (ListPopup) : lignes de 30, titres de 24, séparateurs de 9.
export const listHeight = (rows, titles = 0, seps = 0) => rows * 30 + titles * 24 + seps * 9 + 10;

// La liste repliée en entier (seul l'en-tête reste, avec le compte par état) et le kanban compact :
// dans shared, pour que la barre, ses menus (des copies en overlay) et le kanban voient la même chose.
const FOLD_KEY = "agents-virgile.replie";
export const isFolded = () => shared(FOLD_KEY) === true;
export const setFolded = (v) => setShared(FOLD_KEY, Boolean(v));
const COMPACT_KEY = "agents-virgile.kanban.compact";
export const isCompact = () => shared(COMPACT_KEY) === true;
export const setCompact = (v) => setShared(COMPACT_KEY, Boolean(v));

// Les onglets rangés (tab.settle de Herdr : mis de côté sur cet écran, ils tournent toujours ; un onglet
// affiché, ou dont un agent vous attend, revient de lui-même). Leurs agents vont dans la section
// « Settled », en bas, repliée par défaut. En option, un onglet au repos depuis N jours est rangé tout seul.
const RANGES_OPEN = "agents-virgile.ranges.ouvert";
export const rangesOpen = () => shared(RANGES_OPEN) === true;
export const setRangesOpen = (v) => setShared(RANGES_OPEN, Boolean(v));
const RANGES_AUTO = "agents-virgile.ranges.auto";
export const AUTO_DAYS = [null, 1, 3, 7, 14];
export const autoDays = () => { const v = shared(RANGES_AUTO); return AUTO_DAYS.includes(v) ? v : null; };
export const setAutoDays = (v) => setShared(RANGES_AUTO, AUTO_DAYS.includes(v) ? v : null);
// Ranger l'onglet d'un agent (tout l'onglet : ses autres agents aussi), ou l'en sortir.
export const settleArgs = (a, on = true) => [on ? "tab.settle" : "tab.unsettle", { id: a.tab }];

// Le menu ☰ de l'en-tête (vues.js MenuView of "header") : Kanban view, Auto-settle, Collapse the
// list, le tri (un titre, deux lignes), New group (après un trait), et s'il y a des
// groupes, Collapse/Expand all groups.
export const headerMenuHeight = () => listHeight(Object.keys(data().groups).length ? 8 : 6, 1, 1);
// Le menu d'un agent : Open, Peek, Pin, Settle its tab, Move to a group, New group, (Remove from group),
// Kanban view ; deux traits.
export const agentMenuHeight = (grouped) => listHeight(grouped ? 8 : 7, 0, 2);

// Un menu ouvert vers le haut depuis un point (la liste est en bas de la barre), sinon vers le bas.
export const above = (x, y, width, height) => ({ x: Math.max(8, x), y: y - height - 4 > 8 ? y - height - 4 : y + 4 });

export const icon = (name) => `mods/agents-virgile/icons/${name}.svg`;
export const chrome = (name) => `mods/workspace-chrome/${name}.svg`;

// ---- Les agents ------------------------------------------------------------------------------

export const machineOf = (addr) => (addr && addr.includes("/") ? addr.slice(0, addr.indexOf("/")) : null);
const short = (x) => String(x ?? "").split("/").pop();

// Un mot d'état de terminal comme agents() les donne : une erreur compte comme « needs you », et
// « done » redevient « idle » une fois vu, comme dans agents() : Herdr pose sur le terminal
// l'étiquette herdr.seen = le dernier tour regardé (vu quand elle atteint `turn`).
const word = (k) => {
  const s = k.status;
  if (s === "done" && Number(k.labels?.["herdr.seen"] ?? -1) >= Number(k.turn ?? Infinity)) return "idle";
  return s === "error" ? "blocked" : ["working", "blocked", "done", "idle"].includes(s) ? s : "idle";
};

// Tous les agents : ceux d'agents() (un volet de terminal), plus ceux qu'un volet de chat (Trace)
// cache derrière lui (le terminal étiqueté herdr.chat=<volet>), qu'agents() ne liste pas, et les
// agents sans volet (leur volet de chat fermé). Rangés comme Herdr : par space, puis onglet.
// Les sous-agents (lancés par un agent, `parent`) restent sous leur parent : pas ici.
export function allAgents(ag = agents(), ts = terminals(), ps = panes(), sp = spaces(), f = focused()) {
  const have = new Set(ag.map((a) => a.address));
  const tabOf = new Map();
  sp.forEach((s, si) => (s.tabs ?? []).forEach((c, ci) => tabOf.set(c.id, { s, c, si, ci })));
  // settled : son onglet est rangé (tab.settle) ; settled_at : depuis quand (ms).
  const put = (tab) => { const c = tab ? tabOf.get(tab)?.c : null; return { settled: Boolean(c?.settled), settled_at: c?.settled_at ?? null }; };
  const out = ag.map((a) => ({ ...a, chat: false, ...put(a.tab) }));
  for (const k of ts) {
    if (k.state !== "live" || !k.status || k.parent || have.has(k.address) || !k.program?.agent && !k.report) continue;
    const chat = k.labels?.["herdr.chat"];
    const m = machineOf(k.address);
    const id = chat ? (chat.includes("/") ? chat : m ? `${m}/${chat}` : chat) : null;
    const p = id ? ps.find((x) => x.pane === id) ?? ps.find((x) => !x.terminal && short(x.pane) === short(chat) && machineOf(x.pane) === m) : null;
    const w = p ? tabOf.get(p.tab) : null;
    out.push({
      address: k.address, pane: p?.pane ?? null, space: w?.s.id ?? null,
      space_name: w?.s.name ?? String(k.labels?.where ?? "").split(" / ")[0], tab: p?.tab ?? null,
      tab_index: w ? w.ci + 1 : 0, tab_name: w?.c.name ?? "", status: word(k), app: k.report?.app ?? null,
      program: k.program, title: k.title ?? "", seq: 0, pinned: Boolean(k.labels?.["herdr.pinned"]),
      focused: Boolean(p && f?.pane === p.pane), chat: true, ...put(p?.tab),
    });
  }
  // L'ordre de Herdr : celui des spaces et de leurs onglets ; un agent sans volet à la fin.
  const at = (a) => { const w = a.tab ? tabOf.get(a.tab) : null; return w ? w.si * 1000 + w.ci : 1e9; };
  return out.map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map((x) => x.a);
}

// Ouvrir un agent : son volet (de terminal ou de chat), sinon un aperçu de son terminal.
export const openArgs = (a) => (a.pane ? ["pane.focus", { pane: a.pane }] : ["terminal.peek", { terminal: a.address }]);

// ---- Le tri et les états (comme le mod livré) ------------------------------------------------

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
export const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
export const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
export const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
export const setSort = (id) => setShared("agents.sort", id);

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
export function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// compact: a ! for blocked where a header already says "Needs you".
export function statusMark(t, status, compact = false) {
  const color = t[status] ?? t.dim;
  if (status === "working") return svg(chrome("spinner")).size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  // Idle: a ring; done: a dot.
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(status === "done" ? color : t.dim + "00");
}

// Les étiquettes que la barre Spaces a posées sur l'onglet d'un agent (shared "spaces-virgile").
export function tabLabels(tab) {
  const d = shared("spaces-virgile") ?? {};
  return (d.tags?.[tab] ?? []).map((l) => d.labels?.[l] && { id: l, ...d.labels[l] }).filter(Boolean);
}

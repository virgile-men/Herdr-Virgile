// Étiquettes et groupes de la barre Spaces de Herdr-Virgile : le modèle, sans rien d'herdr
// (testé avec node : arbre.test.mjs, hors de ce dossier).
//
// Rangé dans shared("spaces-virgile"), visible de toutes les copies du mod (barre, dialogues) :
//   labels:     { lid: { name, color } }     couleur "#rrggbb", libre
//   labelOrder: [lid]
//   tags:       { tabId: [lid] }   les étiquettes d'un terminal (onglet) ; avant le 2026-11-15, d'un space
//   groups:     { gid: { name, icon, color, parent, folded } }   parent: gid ou null (racine)
//   children:   { root: ["g:gid"], gid: ["g:gid" | "s:spaceId"] }
//   looks:      { spaceId: { icon, color } }   l'avatar d'un space : icône (null : son initiale), couleur
// Un space est dans au plus un groupe ; un space hors groupe reste sous sa machine.
// Les groupes sont un affichage : ils ne changent jamais l'ordre des spaces de herdr.
// La couleur d'un sous-groupe est celle de son groupe racine.

export const KEY = "spaces-virgile";
export const MAX_DEPTH = 8;

export const PALETTE = ["#e5484d", "#f76b15", "#ffb224", "#46a758", "#12a594", "#00a2c7",
  "#3e63dd", "#6e56cf", "#ab4aba", "#d6409f", "#a18072", "#8d8d8d"];

export const ICONS = ["folder", "folder-open", "star", "heart", "rocket", "briefcase", "code", "terminal",
  "server", "database", "cloud", "globe", "house", "building-2", "flame", "zap", "bug", "wrench", "settings",
  "layers", "package", "box", "book-open", "graduation-cap", "flask-conical", "cpu", "shield", "lock",
  "key-round", "users", "user", "bell", "calendar", "git-branch", "github", "music", "camera", "image", "film",
  "gamepad-2", "coffee", "leaf", "sun", "moon", "flag", "bookmark", "tag", "target", "trophy", "lightbulb",
  "palette", "pen-tool", "message-square", "mail", "shopping-cart", "wallet", "chart-line", "bot", "brain",
  "sparkles", "smartphone", "monitor", "hard-drive", "network", "tv", "plane", "map-pin", "anchor", "puzzle",
  "crown", "gem", "snowflake", "dog", "cat", "circle-dot"];

export const ref = (kind, id) => `${kind}:${id}`;
export const unref = (r) => { const i = r.indexOf(":"); return { kind: r.slice(0, i), id: r.slice(i + 1) }; };

// "#abc", "abc", "#AABBCC" : "#aabbcc" ; autre chose : null.
export function hex(text) {
  let s = String(text ?? "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function normalize(d) {
  d = d && typeof d === "object" ? JSON.parse(JSON.stringify(d)) : {};
  d.labels ??= {};
  d.labelOrder = (d.labelOrder ?? []).filter((l) => d.labels[l]);
  for (const l of Object.keys(d.labels)) if (!d.labelOrder.includes(l)) d.labelOrder.push(l);
  d.tags ??= {};
  d.groups ??= {};
  d.children ??= {};
  d.children.root ??= [];
  d.looks ??= {};
  for (const g of Object.keys(d.groups)) d.children[g] ??= [];
  return d;
}

const newId = (prefix, taken) => {
  for (;;) {
    const id = prefix + Math.random().toString(36).slice(2, 8);
    if (!taken[id]) return id;
  }
};

const listOf = (d, gid) => d.children[gid ?? "root"];

// Retire une référence de la liste où elle est.
function detach(d, r) {
  for (const k of Object.keys(d.children)) {
    const i = d.children[k].indexOf(r);
    if (i !== -1) d.children[k].splice(i, 1);
  }
}

// Insère r dans le groupe (null : la racine), avant `before` ou après `after` s'ils y sont, sinon à la fin.
function insert(d, gid, r, { before = null, after = null } = {}) {
  const list = listOf(d, gid);
  let i = before ? list.indexOf(before) : after ? list.indexOf(after) + (list.includes(after) ? 1 : 0) : -1;
  if (i < 0 || i > list.length) i = list.length;
  list.splice(i, 0, r);
}

export function groupOfSpace(d, sid) {
  const r = ref("s", sid);
  for (const [k, list] of Object.entries(d.children)) if (k !== "root" && list.includes(r)) return k;
  return null;
}

// 1 pour un groupe à la racine.
export function depthOf(d, gid) {
  let n = 0;
  for (let g = gid; g && d.groups[g] && n <= MAX_DEPTH + 1; g = d.groups[g].parent) n++;
  return n;
}

// Le nombre de niveaux qu'il occupe : 1 sans sous-groupe.
export function heightOf(d, gid) {
  const kids = (d.children[gid] ?? []).map(unref).filter((x) => x.kind === "g" && d.groups[x.id]);
  return 1 + Math.max(0, ...kids.map((x) => heightOf(d, x.id)));
}

// gid est-il `of` ou un de ses descendants ?
export function within(d, gid, of) {
  for (let g = gid; g; g = d.groups[g]?.parent) if (g === of) return true;
  return false;
}

export const rootOf = (d, gid) => { let g = gid; while (d.groups[g]?.parent) g = d.groups[g].parent; return g; };
export const colorOf = (d, gid) => d.groups[rootOf(d, gid)]?.color ?? PALETTE[6];

// Peut-on mettre le groupe gid dans `into` (null : la racine) ?
export function canNest(d, gid, into) {
  if (!into) return true;
  if (!d.groups[into] || within(d, into, gid)) return false;
  return depthOf(d, into) + heightOf(d, gid) <= MAX_DEPTH;
}

// Les spaces d'un groupe et de ses sous-groupes.
export function spacesIn(d, gid) {
  const out = [];
  for (const r of d.children[gid] ?? []) {
    const x = unref(r);
    if (x.kind === "s") out.push(x.id);
    else if (d.groups[x.id]) out.push(...spacesIn(d, x.id));
  }
  return out;
}

export function addGroup(d, { name, icon = "folder", color = null, parent = null, before = null, after = null }) {
  d = normalize(d);
  if (parent && (!d.groups[parent] || depthOf(d, parent) >= MAX_DEPTH)) return [d, null];
  const gid = newId("g", d.groups);
  d.groups[gid] = { name: String(name ?? "").trim() || "Groupe", icon, color: parent ? null : (hex(color) ?? PALETTE[6]), parent, folded: false };
  d.children[gid] = [];
  insert(d, parent, ref("g", gid), { before, after });
  return [d, gid];
}

export function editGroup(d, gid, { name, icon, color }) {
  d = normalize(d);
  const g = d.groups[gid];
  if (!g) return d;
  if (name !== undefined) g.name = String(name).trim() || g.name;
  if (icon !== undefined) g.icon = icon;
  if (color !== undefined && !g.parent) g.color = hex(color) ?? g.color;
  return d;
}

export function setFolded(d, gid, folded) {
  d = normalize(d);
  if (d.groups[gid]) d.groups[gid].folded = folded;
  return d;
}

// Dégrouper : son contenu prend sa place dans son parent (à la racine, ses spaces retournent sous leur machine).
export function removeGroup(d, gid) {
  d = normalize(d);
  const g = d.groups[gid];
  if (!g) return d;
  const parent = g.parent;
  const list = listOf(d, parent);
  let at = list.indexOf(ref("g", gid));
  if (at === -1) at = list.length;
  const kids = d.children[gid] ?? [];
  const moved = parent ? kids : kids.filter((r) => unref(r).kind === "g");
  list.splice(at, 1, ...moved);
  for (const r of kids) { const x = unref(r); if (x.kind === "g" && d.groups[x.id]) d.groups[x.id].parent = parent; }
  // Un sous-groupe qui devient racine garde la couleur qu'il montrait.
  if (!parent) for (const r of moved) { const x = unref(r); if (d.groups[x.id]) d.groups[x.id].color ??= g.color; }
  delete d.groups[gid];
  delete d.children[gid];
  return d;
}

// Déplacer un groupe dans `into` (null : la racine), avant/après une référence de ce groupe-là.
export function moveGroup(d, gid, { into = null, before = null, after = null } = {}) {
  d = normalize(d);
  const g = d.groups[gid];
  if (!g || !canNest(d, gid, into) || before === ref("g", gid) || after === ref("g", gid)) return d;
  const color = colorOf(d, gid);
  detach(d, ref("g", gid));
  g.parent = into;
  // À la racine, il garde la couleur qu'il montrait ; dedans, il prend celle de son parent.
  g.color = into ? null : (g.color ?? color);
  insert(d, into, ref("g", gid), { before, after });
  return d;
}

// Déplacer un space dans un groupe (null : hors groupe, sous sa machine).
export function moveSpace(d, sid, { into = null, before = null, after = null } = {}) {
  d = normalize(d);
  if (into && !d.groups[into]) return d;
  const r = ref("s", sid);
  if (before === r || after === r) return d;
  detach(d, r);
  if (into) insert(d, into, r, { before, after });
  return d;
}

export function addLabel(d, { name, color }) {
  d = normalize(d);
  const n = String(name ?? "").trim();
  const c = hex(color);
  if (!n || !c) return [d, null];
  const lid = newId("l", d.labels);
  d.labels[lid] = { name: n, color: c };
  d.labelOrder.push(lid);
  return [d, lid];
}

export function editLabel(d, lid, { name, color }) {
  d = normalize(d);
  const l = d.labels[lid];
  if (!l) return d;
  if (name !== undefined && String(name).trim()) l.name = String(name).trim();
  if (color !== undefined && hex(color)) l.color = hex(color);
  return d;
}

export function removeLabel(d, lid) {
  d = normalize(d);
  delete d.labels[lid];
  d.labelOrder = d.labelOrder.filter((l) => l !== lid);
  for (const [s, list] of Object.entries(d.tags)) {
    d.tags[s] = list.filter((l) => l !== lid);
    if (!d.tags[s].length) delete d.tags[s];
  }
  return d;
}

export function toggleTag(d, sid, lid) {
  d = normalize(d);
  if (!d.labels[lid]) return d;
  const list = d.tags[sid] ?? [];
  d.tags[sid] = list.includes(lid) ? list.filter((l) => l !== lid) : [...list, lid];
  if (!d.tags[sid].length) delete d.tags[sid];
  return d;
}

// L'avatar choisi pour un space ; null efface le choix (Herdr reprend son initiale et sa couleur).
export function setLook(d, sid, look) {
  d = normalize(d);
  if (!look) delete d.looks[sid];
  else d.looks[sid] = { icon: look.icon ?? null, color: hex(look.color) };
  return d;
}

export const labelsOf = (d, sid) => (d.tags[sid] ?? []).map((l) => d.labels[l] && { id: l, ...d.labels[l] }).filter(Boolean);

// La machine d'un id de space : "pve-dell/sp…" -> "pve-dell", "sp…" -> null.
export const machineOfId = (sid) => (sid.includes("/") ? sid.slice(0, sid.indexOf("/")) : null);

// Oublie les spaces fermés, mais seulement sur une machine dont la disposition est lisible
// (`ready`) : une machine injoignable ou qui charge ne liste pas ses spaces, ils ne sont pas fermés.
// Renvoie null si rien ne change.
export function prune(d, liveIds, readyMachines) {
  d = normalize(d);
  const live = new Set(liveIds);
  const ready = new Set(readyMachines);
  const gone = (sid) => !live.has(sid) && ready.has(machineOfId(sid));
  let changed = false;
  for (const k of Object.keys(d.children)) {
    const kept = d.children[k].filter((r) => {
      const x = unref(r);
      return x.kind === "g" ? Boolean(d.groups[x.id]) : !gone(x.id);
    });
    if (kept.length !== d.children[k].length) { d.children[k] = kept; changed = true; }
  }
  for (const s of Object.keys(d.tags)) if (gone(s)) { delete d.tags[s]; changed = true; }
  for (const s of Object.keys(d.looks)) if (gone(s)) { delete d.looks[s]; changed = true; }
  return changed ? d : null;
}

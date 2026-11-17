// Le journal des notifications que montre le panneau Alertes : celles de Herdr (un agent attend votre
// réponse ; un agent a fini pendant que vous ne regardiez pas), reconstituées par la veille à partir des
// statuts des agents, puisque Herdr n'en garde pas (son mod toast les affiche puis les oublie), et celles
// des sections Blast Radius (une commande retenue) et Règles (une règle proposée).
// Source : ~/herdr-panneaux/panneaux/_commun/notifs.js, copiée dans alertes/ et tabs-vault/ par vault-setup.py.
import { shared, setShared } from "herdr";

export const JOURNAL = "alertes.notifications";   // [{ id, at, type, titre, nom, corps, addr }], la plus récente d'abord
export const VU = "alertes.vu";                    // l'heure jusqu'où tout a été vu (panneau à l'écran)
export const ATTENTE = "regles.attente";           // { "<machine>" : [{ id, rule, project }] } : règles en attente
const MAX = 100;

// Le titre d'une notification, en anglais, à partir de son type et du nom de l'agent (champ `nom`).
// Le panneau le recalcule à l'affichage : les entrées d'avant le 2026-11-17 ont un titre français déjà
// rendu et pas de `nom`, qu'on retrouve dans ce titre (ANCIENS). Type inconnu : le titre gardé.
const TITRES = {
  attend: (nom) => `${nom} needs your answer`,
  fini: (nom) => `${nom} finished`,
  blast: (nom) => `${nom}: command held`,
  regle: (nom) => `Suggested rule · ${nom}`,
};
const ANCIENS = {
  attend: /^(.+) attend votre réponse$/,
  fini: /^(.+) a terminé$/,
  blast: /^(.+) : commande retenue$/,
  regle: /^Règle proposée · (.+)$/,
};
export function titreNotif(n) {
  const f = TITRES[n?.type];
  if (!f) return String(n?.titre ?? "");
  const nom = n.nom || ANCIENS[n.type].exec(String(n.titre ?? ""))?.[1] || n.addr || "Agent";
  return f(nom);
}

// n : { type, nom, corps, addr } ; le titre est calculé ici (titreNotif). type : "attend" (un agent attend
// une réponse), "fini" (un agent a fini), "blast" (commande retenue), "regle" (règle proposée).
export function journaliser(n) {
  const at = Date.now();
  n = { ...n, titre: titreNotif(n) };
  let l = shared(JOURNAL) ?? [];
  // Une commande retenue met aussi l'agent en attente : la retenue, plus précise, remplace « needs your answer ».
  if (n.type === "blast") l = l.filter((x) => !(x.type === "attend" && x.addr === n.addr && at - x.at < 30000));
  if (l.some((x) => x.type === n.type && x.addr === n.addr && x.titre === n.titre && at - x.at < 5000)) return;
  setShared(JOURNAL, [{ id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, ...n }, ...l].slice(0, MAX));
}

export const journal = () => shared(JOURNAL) ?? [];
export const nonVues = () => { const vu = Number(shared(VU)) || 0; return journal().filter((x) => x.at > vu).length; };
export const reglesEnAttente = () => Object.values(shared(ATTENTE) ?? {}).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);

// Les règles en attente d'une machine (null : ici), pour le compte de l'en-tête. Appelée par la section
// Règles et par la veille.
export function noterAttente(machine, items) {
  const cle = machine ?? "";
  const tout = { ...(shared(ATTENTE) ?? {}) };
  const liste = items.map((x) => ({ id: x.id, rule: x.rule, project: x.project ?? "" }));
  if (JSON.stringify(tout[cle] ?? []) !== JSON.stringify(liste)) {
    if (liste.length) tout[cle] = liste; else delete tout[cle];
    setShared(ATTENTE, tout);
  }
}

// Les règles en attente pas encore signalées (une notification chacune, une seule fois), notées comme
// signalées. Appelée par la veille seulement : que la section Règles les ait déjà lues n'y change rien.
export const SIGNALEES = "regles.signalees";
export function aSignaler(machine, items) {
  const cle = machine ?? "";
  const deja = new Set(shared(SIGNALEES) ?? []);
  const neuves = items.filter((x) => x?.id && !deja.has(`${cle}|${x.id}`));
  if (neuves.length) setShared(SIGNALEES, [...deja, ...neuves.map((x) => `${cle}|${x.id}`)].slice(-300));
  return neuves;
}

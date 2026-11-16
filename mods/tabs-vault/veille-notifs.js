// Veille des notifications, lancée par l'en-tête (tabs-vault) toutes les 2 s, pour le panneau Alertes.
// Copiée dans tabs-vault/ par vault-setup.py, à côté de veille-blast.js et notifs.js.
//
// - Herdr ne garde pas ses notifications : elles sont reconstituées ici à partir des statuts des agents
//   (terminals(), qui voit aussi ceux rangés derrière un volet de chat). Un agent qui passe à « blocked »
//   attend votre réponse ; un agent qui passe à « done » a fini. Rien pour l'agent que vous regardez
//   (son terminal ou son volet de chat, fenêtre active), comme Herdr.
// - Règles : reflect-mod vérifie chaque nouveau message envoyé à Claude Code. Quand un agent Claude se
//   remet au travail, le store du plugin de sa machine est relu 20 s puis 60 s plus tard (un `exec`,
//   rien d'autre entre-temps). Une règle nouvelle en attente : une notification et un toast Herdr.
// - Le libellé du bouton de l'en-tête : « Alertes · N » (commandes retenues + règles en attente), sinon
//   « Alertes • » s'il y a des notifications pas encore vues.
import { terminals, exec, notify, window as fenetreApp } from "herdr";
import { journaliser, noterAttente, aSignaler, nonVues, reglesEnAttente } from "./notifs.js";
import { suivi, nomDe, nombre as nbBlast } from "./veille-blast.js";

const ETATS = ["working", "blocked", "done", "idle"];
const statuts = new Map();   // adresse → statut
const prevus = new Map();    // machine ("" : ici) → { quand: [ms…], addr }
let premier = true;
let occupe = false;

const STORE = String.raw`
for f in "$HOME"/.claude/plugins/store/reflect-mod_*.json; do [ -f "$f" ] && { tr -d '\n' < "$f"; echo; }; done
true`;

const statutDe = (k) => { const s = typeof k.status === "string" ? k.status : k.report?.state; return ETATS.includes(s) ? s : null; };
const estClaude = (k) => k.report?.app === "claude-code" || k.agent === "claude-code";
const machineDe = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");

export function libelleAlertes() {
  const n = nbBlast() + reglesEnAttente();
  return n ? `Alertes · ${n}` : nonVues() ? "Alertes •" : "Alertes";
}

function prevoir(machine, quand, addr) {
  const p = prevus.get(machine) ?? { quand: [], addr };
  if (!p.quand.some((q) => Math.abs(q - quand) < 5000)) p.quand.push(quand);
  p.quand.sort((a, b) => a - b);
  p.addr = addr;
  prevus.set(machine, p);
}

export function veillerNotifs(cx) {
  const m = Date.now();
  const vus = new Set();
  for (const k of terminals()) {
    if (k.state !== "live") continue;
    const s = statutDe(k);
    if (!s) continue;
    const addr = k.address;
    vus.add(addr);
    const avant = statuts.get(addr);
    statuts.set(addr, s);
    // Au démarrage : rien à signaler, mais les règles en attente de chaque machine sont relues une fois.
    if (premier) { if (estClaude(k)) prevoir(machineDe(addr), m + 5000, addr); continue; }
    if (avant === undefined || avant === s) continue;
    const msg = k.report?.msg ? String(k.report.msg) : "";
    // L'agent que vous regardez (son terminal ou son volet de chat, fenêtre active) : rien à signaler.
    const regarde = suivi() === addr && fenetreApp()?.active;
    if (regarde) { /* rien */ } else if (s === "blocked") {
      journaliser({ type: "attend", titre: `${nomDe(addr)} attend votre réponse`, corps: msg, addr });
    } else if (s === "done") {
      journaliser({ type: "fini", titre: `${nomDe(addr)} a terminé`, corps: msg, addr });
    }
    if (s === "working" && estClaude(k)) { prevoir(machineDe(addr), m + 20000, addr); prevoir(machineDe(addr), m + 60000, addr); }
  }
  for (const a of [...statuts.keys()]) if (!vus.has(a)) statuts.delete(a);
  premier = false;
  lireStores(cx, m);
}

function lireStores(cx, m) {
  if (occupe) return;
  const dues = [...prevus.entries()].filter(([, p]) => p.quand.length && p.quand[0] <= m);
  if (!dues.length) return;
  for (const [, p] of dues) p.quand.shift();
  occupe = true;
  cx.spawn(async (cx) => {
    try {
      for (const [machine, p] of dues) {
        const r = await exec("sh", ["-c", STORE], { on: machine || null, timeout: 15000 }).catch(() => null);
        if (!r || r.code !== 0) continue;
        const items = [];
        for (const l of r.stdout.split("\n")) { try { const d = JSON.parse(l); if (Array.isArray(d?.items)) items.push(...d.items); } catch {} }
        const enAttente = items.filter((x) => x?.status === "pending");
        noterAttente(machine || null, enAttente);
        const nouvelles = aSignaler(machine || null, enAttente);
        for (const n of nouvelles) {
          journaliser({ type: "regle", titre: `Règle proposée · ${nomDe(p.addr)}`, corps: n.rule, addr: p.addr });
          notify({ title: "reflect-mod propose une règle", body: n.rule, level: "info", timeout: 10000,
            action: { name: "agent.focus", args: { terminal: p.addr } } });
        }
      }
    } finally {
      occupe = false;
      cx.notify();
    }
  });
}

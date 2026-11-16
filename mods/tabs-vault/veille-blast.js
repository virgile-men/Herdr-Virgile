// Veille Blast Radius : repère les agents Claude Code dont le plugin Blast Radius retient une commande
// risquée (son panneau « ⚠ Blast Radius · … », « 1: Proceed  2: Cancel »), pour que ça se voie
// dans herdr-app même quand le terminal est caché derrière un volet de chat.
// Lancée par l'en-tête (tabs-vault), présent dans toute la fenêtre ; copiée dans tabs-vault/veille-blast.js
// et dans alertes/ par vault-setup.py. Source : ~/herdr-panneaux/panneaux/alertes/veille.js.
// Chaque nouvelle retenue va aussi dans le journal des notifications (notifs.js) du panneau Alertes.
//
// Coût : un `hc read` par terminal Claude Code qui travaille, 2,5 s puis 8 s après chaque changement de ce qu'il
// fait (son message de statut), puis toutes les 30 s tant qu'il travaille ; toutes les 4 s pour une
// commande retenue (jusqu'à ce qu'on y réponde, ici ou dans le terminal).
import { agents, terminals, hc, shared, setShared, notify, playSound, run, layout, focused, panes } from "herdr";
import { journaliser } from "./notifs.js";

// Les terminaux où tourne Claude Code, qu'ils aient un onglet ou soient rangés derrière un volet de chat
// (étiquette herdr.chat, absents d'agents()) : { address, statut, msg }.
const claudes = () => terminals()
  .filter((k) => k.state === "live" && (k.report?.app === "claude-code" || k.agent === "claude-code"))
  .map((k) => ({ address: k.address, statut: typeof k.status === "string" ? k.status : k.report?.state ?? "", msg: k.report?.msg ?? "" }));
export const nomDe = (addr) => {
  const a = agents().find((x) => x.address === addr);
  return a?.tab_name || a?.space_name || terminals().find((x) => x.address === addr)?.labels?.where || addr;
};

export const CLE = "blast-radius.retenues";
const suivis = new Map(); // adresse → { cle, quand: [ms...], ouvert }
let occupe = false;

// Le panneau du plugin à l'écran → { label, commande, effet }, sinon null. Exige sa ligne de boutons
// (« 1: Proceed  2: Cancel », suivie de « Claude is waiting on your answer », replié dans un terminal
// étroit) ET, au plus 30 lignes plus haut, son titre « ⚠ Blast Radius · » : un écran qui ne fait que citer
// ce texte ne doit pas recevoir de 1 ou de 2.
const BOUTONS = /1: Proceed\s+2: Cancel\s+Claude is/;
export function lireRetenue(ecran) {
  const lignes = String(ecran ?? "").split("\n");
  let b = lignes.length - 1;
  while (b >= 0 && !BOUTONS.test(lignes[b])) b -= 1;
  if (b < 0) return null;
  let t = b - 1;
  while (t >= Math.max(0, b - 30) && !lignes[t].includes("⚠ Blast Radius · ")) t -= 1;
  if (t < Math.max(0, b - 30)) return null;
  const bloc = lignes.slice(t, b + 1).join("\n");
  const pris = (re) => (re.exec(bloc)?.[1] ?? "").replace(/\s+$/, "");
  return { label: pris(/⚠ Blast Radius · ([^│\n]*)/), commande: pris(/Command {2}([^│\n]*)/), effet: pris(/Would {4}([^│\n]*)/) };
}

export const retenues = () => ({ ...(shared(CLE) ?? {}) });
export const nombre = () => Object.keys(shared(CLE) ?? {}).length;

// L'agent dont la fenêtre parle (comme Contexte) : le terminal du volet actif, ou l'agent d'un volet de chat.
export function suivi() {
  const f = focused();
  if (!f) return null;
  const p = f.pane ? panes().find((x) => x.pane === f.pane) : null;
  if (p?.terminal) return p.terminal;
  if (f.pane) {
    const court = (s) => String(s ?? "").split("/").pop();
    const k = terminals().find((x) => x.state === "live" && x.labels?.["herdr.chat"]
      && (x.labels["herdr.chat"] === f.pane || court(x.labels["herdr.chat"]) === court(f.pane)));
    if (k) return k.address;
  }
  return f.terminal ?? f.agent ?? null;
}

const trouve = (n, id) => {
  if (n?.id === id) return n;
  for (const c of n?.children ?? []) { const r = trouve(c, id); if (r) return r; }
  return null;
};
const PANNEAU = "alertes";
function ouvrirPanneau() {
  const body = trouve(layout(), "panel-body");
  if (!body || !(body.children ?? []).some((c) => c.id === PANNEAU)) return;
  run("layout.select", { stack: "panel-body", child: PANNEAU });
  run("layout.show", { id: "panel" });
}

export function marquer(addr, r) {
  const m = retenues();
  if (r) m[addr] = { ...(m[addr] ?? { depuis: Date.now() }), ...r };
  else delete m[addr];
  if (JSON.stringify(m) !== JSON.stringify(shared(CLE) ?? {})) setShared(CLE, m);
}

// Regarde l'écran d'un agent. -> la retenue, ou null.
export async function regarder(addr) {
  const r = await hc(["read", addr]).catch(() => null);
  return r && r.code === 0 ? lireRetenue(r.stdout) : null;
}

export function veiller(cx) {
  if (occupe) return;
  const maintenant = Date.now();
  const m = retenues();
  const vus = new Set();
  for (const a of claudes()) {
    vus.add(a.address);
    const cle = `${a.statut}|${a.msg}`;
    const s = suivis.get(a.address) ?? { cle: null, quand: [] };
    if (s.cle !== cle) {
      s.cle = cle;
      s.quand = a.statut === "working" ? [maintenant + 2500, maintenant + 8000] : [];
    }
    if (m[a.address]) { if (!s.quand.length) s.quand = [maintenant + 4000]; }
    else if (a.statut === "working" && !s.quand.length) s.quand = [maintenant + 30000];
    suivis.set(a.address, s);
  }
  // Un agent parti (ou qui n'est plus Claude Code) ne retient plus rien.
  for (const addr of Object.keys(m)) if (!vus.has(addr)) marquer(addr, null);
  for (const addr of [...suivis.keys()]) if (!vus.has(addr)) suivis.delete(addr);

  const dus = [...suivis.entries()].filter(([, s]) => s.quand.length && s.quand[0] <= maintenant).map(([addr]) => addr);
  if (!dus.length) return;
  occupe = true;
  cx.spawn(async (cx) => {
    try {
      for (const addr of dus) {
        const s = suivis.get(addr);
        if (s) s.quand.shift();
        const r = await regarder(addr);
        const avant = retenues()[addr];
        marquer(addr, r);
        if (r && !avant) {
          playSound("blocked");
          journaliser({ type: "blast", titre: `${nomDe(addr)} : commande retenue`, corps: `${r.commande || r.label}${r.effet ? ` → ${r.effet}` : ""}`, addr });
          notify({
            title: "Blast Radius retient une commande",
            body: `${nomDe(addr)} · ${r.commande || r.label}${r.effet ? ` → ${r.effet}` : ""}`,
            level: "warning", timeout: 20000,
            action: { name: "agent.focus", args: { terminal: addr } },
          });
        }
        if (r && s && !s.quand.length) s.quand = [Date.now() + 4000];
      }
      // L'agent suivi retient une commande : le panneau s'ouvre, une fois par retenue.
      const ici = suivi(), mm = retenues();
      if (ici && mm[ici] && !suivis.get(ici)?.ouvert) { ouvrirPanneau(); const s = suivis.get(ici); if (s) s.ouvert = true; }
      for (const [addr, s] of suivis) if (!mm[addr]) s.ouvert = false;
    } finally {
      occupe = false;
      cx.notify();
    }
  });
}

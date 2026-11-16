// Noms d'onglets automatiques : un onglet qui contient une session Claude Code prend le nom de la
// session (celui que /usage montre : le titre que Claude Code génère, ou celui posé par /rename),
// lu dans le titre que Claude Code donne à son terminal (« ✳ Titre », une roue en tête quand il
// travaille). Agent d'un volet de chat (Trace) : le terminal étiqueté herdr.chat=<volet>, rangé
// derrière lui, dont le titre vient de `hc get`.
// Agent sbx (sandbox de pve-dell lancée par `sbx agent`, dans un terminal hc étiqueté sbx.agent=<nom>) :
// l'onglet prend le nom de l'agent, et son espace s'appelle « sbx ».
// Seuls changent les onglets (et espaces) que personne n'a nommés, ou nommés par ce module
// (shared("tabs.auto") = { <onglet ou espace>: <nom> }) : un nom donné à la main est gardé.
import { spaces, panes, agents, terminals, shared, setShared, run, hc } from "herdr";

const GENERIQUE = /^(claude( code)?|codex|bash|zsh|sh|fish)?$/i;
const MAX = 40;
let occupe = false;

export function nomDe(titre) {
  const n = String(titre ?? "").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
  if (GENERIQUE.test(n)) return null;
  return n.length > MAX ? `${n.slice(0, MAX - 1).trimEnd()}…` : n;
}

const court = (s) => String(s ?? "").split("/").pop();

// Le nom de l'agent sbx d'un onglet, ou null.
const agentSbx = (tab) => terminals().find((k) => k.state === "live" && k.labels?.["sbx.agent"]
  && court(k.labels["herdr.tab"]) === court(tab))?.labels["sbx.agent"] ?? null;

// Le titre de la session Claude Code d'un onglet, ou null.
async function titreDe(tab) {
  const a = agents().find((x) => x.tab === tab && /claude/i.test(`${x.app ?? ""} ${x.program?.key ?? ""}`));
  if (a) return a.title;
  for (const p of panes().filter((x) => x.tab === tab && x.mod === "chat")) {
    const k = terminals().find((x) => x.state === "live" && x.labels?.["herdr.chat"]
      && (x.labels["herdr.chat"] === p.pane || court(x.labels["herdr.chat"]) === court(p.pane)));
    if (!k) continue;
    try {
      const t = JSON.parse((await hc(["get", k.address, "--json"])).stdout || "null");
      if (/claude/i.test(`${t?.status?.app ?? ""} ${t?.foreground?.name ?? ""}`)) return t?.title ?? null;
    } catch {}
  }
  return null;
}

export async function nommerOnglets() {
  if (occupe) return;
  occupe = true;
  try {
    const auto = shared("tabs.auto") ?? {};
    const suite = { ...auto };
    let change = false;
    for (const s of spaces()) {
      let sbx = false;
      for (const tab of s.tabs ?? []) {
        const agent = agentSbx(tab.id);
        if (agent) sbx = true;
        // À la personne : un onglet nommé, et pas par ce module.
        if (tab.named && auto[tab.id] !== tab.name) continue;
        const n = agent ?? nomDe(await titreDe(tab.id));
        if (!n || n === tab.name) continue;
        run("tab.rename", { id: tab.id, name: n });
        suite[tab.id] = n;
        change = true;
      }
      if (sbx && s.name !== "sbx" && (!s.named || auto[s.id] === s.name)) {
        run("space.rename", { id: s.id, name: "sbx" });
        suite[s.id] = "sbx";
        change = true;
      }
    }
    if (change) setShared("tabs.auto", suite);
  } finally {
    occupe = false;
  }
}

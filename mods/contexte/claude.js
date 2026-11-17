// Commun aux panneaux Équipe, Cache, Règles et Blast Radius : la session Claude Code dont on parle,
// la lecture de son journal par morceaux et les tarifs. Source : ~/herdr-panneaux/panneaux/_commun/claude.js,
// copiée dans chaque mod par vault-setup.py (un mod ne peut rien importer hors de son dossier).
import { exec, hc, focused, panes, terminals, layout, props } from "herdr";

export const machineDe = (addr) => (addr && addr.includes("/") ? addr.split("/")[0] : null);

// Un script sh sur la machine de l'agent (null : ici).
export const sh = (script, args, machine, timeout = 30000) =>
  exec("sh", ["-c", script, "claude-mod", ...args], { on: machine, timeout });

// Le terminal dont parler, comme Contexte : d'abord le volet actif (son terminal ou, pour un volet de
// chat, l'agent qui porte son étiquette herdr.chat), ensuite le terminal d'un bloc, l'agent d'un bloc.
export function cible() {
  const f = focused();
  if (!f) return null;
  const p = f.pane ? panes().find((x) => x.pane === f.pane) : null;
  if (p?.terminal) return p.terminal;
  if (f.pane) {
    const court = (s) => String(s ?? "").split("/").pop();
    const vivants = terminals().filter((k) => k.state === "live" && k.labels?.["herdr.chat"]);
    const k = vivants.find((x) => x.labels["herdr.chat"] === f.pane)
      ?? vivants.find((x) => court(x.labels["herdr.chat"]) === court(f.pane));
    if (k) return k.address;
    if (p?.mod) return null;
  }
  return f.terminal ?? f.agent ?? null;
}

// Le panneau est-il à l'écran ? Dans la pile « panel-body » de la disposition : seulement quand il est
// l'enfant actif et le panneau ouvert. En fenêtre, ou dans une disposition sans cette pile : oui.
const trouve = (n, id) => {
  if (n?.id === id) return n;
  for (const c of n?.children ?? []) { const r = trouve(c, id); if (r) return r; }
  return null;
};
export function affiche(id) {
  if (props()?.overlay) return true;
  const root = layout(), body = trouve(root, "panel-body");
  if (!body || !(body.children ?? []).some((c) => c.id === id)) return true;
  return !trouve(root, "panel")?.hidden && body.active === id;
}

// Session d'un processus Claude Code (lui ou un enfant) :
// "<id>\t<dossier>\t<journal>\t<taille>\t<version>".
const SESSION = String.raw`
pid="$1"
kids() { for k in $(pgrep -P "$1" 2>/dev/null); do echo "$k"; kids "$k"; done; }
for p in "$pid" $(kids "$pid"); do
  j="$HOME/.claude/sessions/$p.json"; [ -f "$j" ] || continue
  id=$(sed -n 's/.*"sessionId":"\([0-9a-fA-F-]*\)".*/\1/p' "$j"); [ -n "$id" ] || continue
  cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$j")
  ver=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$j")
  for f in "$HOME"/.claude/projects/*/"$id".jsonl; do
    [ -f "$f" ] && { printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$cwd" "$f" "$(wc -c < "$f" | tr -d ' ')" "$ver"; exit 0; }
  done
  printf '%s\t%s\t\t0\t%s\n' "$id" "$cwd" "$ver"; exit 0
done
true`;

// La session Claude Code d'un terminal : { addr, machine, pid, id, cwd, file, size, version, argv },
// ou { erreur } quand il n'y en a pas.
export async function session(addr) {
  let t = null;
  try { t = JSON.parse((await hc(["get", addr, "--json"])).stdout || "null"); } catch {}
  const fg = t?.foreground ?? {};
  const app = String(t?.status?.app ?? fg.name ?? "");
  if (!fg.pid || !/claude/i.test(app + " " + (fg.argv ?? []).join(" "))) return { erreur: "No Claude Code session in this terminal." };
  const machine = machineDe(addr);
  const s = await sh(SESSION, [String(fg.pid)], machine, 20000);
  const [id, cwd, file, size, version] = s.stdout.trim().split("\n").pop()?.split("\t") ?? [];
  if (!id) return { erreur: "Claude Code session not found (not started yet?)." };
  return { addr, machine, pid: fg.pid, id, cwd: cwd || fg.cwd || "", file: file || "", size: Number(size) || 0, version: version || "", argv: fg.argv ?? [], statut: t?.status ?? null };
}

// ---- Lecture d'un journal par morceaux -------------------------------------------------------
// `agrege <fichier> <depuis> <dernier id> <saut>` lit ce que le fichier a gagné depuis l'octet <depuis>
// (lignes entières seulement) et écrit, une ligne par chose vue :
//   E <fin> <début>                        où reprendre la prochaine fois
//   F\t<horodatage>                        la première ligne datée (lecture depuis 0)
//   C\t<horodatage>                        un compactage
//   R\t<ts>\t<modèle>\t<entrée>\t<écrit>\t<lu>\t<sortie>\t<écrit 1h>\t<ttl>\t<effort>\t<id>
//                                          une réponse du modèle (une fois par message, même
//                                          si Claude Code l'écrit en plusieurs lignes)
//   P\t<ligne>                             un appel aux outils de savvy-progress (ligne JSON entière)
//   L\t<dernier id>
// <saut> = 1 : <depuis> tombe au milieu d'une ligne, la première est sautée.
export const AGREGE = String.raw`
# Les octets [<de>, <à>) d'un fichier (tail -c +N est lent sur macOS quand il recopie beaucoup).
morceau() { if [ "$2" -eq 0 ]; then head -c "$3" "$1"; else tail -c +$(($2 + 1)) "$1" | head -c $(($3 - $2)); fi; }
# Où finit la dernière ligne entière (la taille, sans une ligne en cours d'écriture).
fin_entiere() {
  s=$(wc -c < "$1" | tr -d ' ')
  if [ "$s" -gt "$2" ] && [ "$(tail -c 1 "$1" | wc -l | tr -d ' ')" = 0 ]; then
    echo $((s - $(tail -c 1048576 "$1" | LC_ALL=C awk 'END { print length($0) }')))
  else echo "$s"; fi
}
agrege() {
  f="$1"; o="$2"; dernier="$3"; saut="$4"
  [ -f "$f" ] || { echo "E 0 0 manquant"; return 0; }
  [ "$(wc -c < "$f" | tr -d ' ')" -lt "$o" ] && { o=0; saut=0; }
  e=$(fin_entiere "$f" "$o")
  [ "$e" -lt "$o" ] && e="$o"
  echo "E $e $o"
  [ "$e" -gt "$o" ] || { printf 'L\t%s\n' "$dernier"; return 0; }
  morceau "$f" "$o" "$e" | LC_ALL=C awk -v last="$dernier" -v base="$o" -v saut="$saut" '
function val(s, k,   r) { if (match(s, "\"" k "\":\"[^\"]*\"")) return substr(s, RSTART + length(k) + 4, RLENGTH - length(k) - 5); return "" }
function num(s, k) { if (match(s, "\"" k "\":[0-9]+")) return substr(s, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0; return 0 }
function lastts(s,   t, r) { r = ""; t = s; while (match(t, /"timestamp":"[^"]*"/)) { r = substr(t, RSTART + 13, RLENGTH - 14); t = substr(t, RSTART + RLENGTH) } return r }
{
  if (NR == 1 && saut == 1) next
  line = $0
  if (!vu && base == 0) { t = val(line, "timestamp"); if (t != "") { print "F\t" t; vu = 1 } }
  if (index(line, "\"subtype\":\"compact_boundary\"")) { print "C\t" lastts(line); next }
  if (index(line, "\"type\":\"tool_use\",\"id\":") && index(line, "\"name\":\"mcp__savvy-progress__") && length(line) < 262144) print "P\t" line
  if (index(line, "\"role\":\"assistant\"") && (u = index(line, "\"usage\":{"))) {
    id = ""
    if (match(line, /"id":"msg_[^"]*"/)) id = substr(line, RSTART + 6, RLENGTH - 7)
    if (id != "" && id == last) next
    last = id
    us = substr(line, u)
    print "R\t" lastts(line) "\t" val(line, "model") "\t" num(us, "input_tokens") "\t" num(us, "cache_creation_input_tokens") "\t" num(us, "cache_read_input_tokens") "\t" num(us, "output_tokens") "\t" num(us, "ephemeral_1h_input_tokens") "\t" val(line, "promptCacheRequested") "\t" val(line, "effort") "\t" id
  }
}
END { print "L\t" last }'
}`;

// La sortie d'agrege → { fin, debut, manquant, premier, compacts: [ts], reponses: [...], appels: [obj], dernier }.
export function lireAgrege(texte) {
  const out = { fin: 0, debut: 0, manquant: false, premier: null, compacts: [], reponses: [], appels: [], dernier: "" };
  for (const l of String(texte ?? "").split("\n")) {
    if (l.startsWith("E ")) { const [, e, o, m] = l.split(" "); out.fin = Number(e) || 0; out.debut = Number(o) || 0; out.manquant = m === "manquant"; continue; }
    const tab = l.indexOf("\t");
    if (tab < 0) continue;
    const k = l.slice(0, tab), reste = l.slice(tab + 1);
    if (k === "F") out.premier = Date.parse(reste) || null;
    else if (k === "C") out.compacts.push(Date.parse(reste) || 0);
    else if (k === "L") out.dernier = reste;
    else if (k === "P") {
      let j = null;
      try { j = JSON.parse(reste); } catch {}
      for (const c of j?.message?.content ?? []) {
        if (c?.type === "tool_use" && String(c.name).startsWith("mcp__savvy-progress__"))
          out.appels.push({ outil: c.name.replace("mcp__savvy-progress__", ""), entree: c.input ?? {}, at: Date.parse(j.timestamp) || 0 });
      }
    } else if (k === "R") {
      const [ts, modele, entree, ecrit, lu, sortie, ecrit1h, ttl, effort, id] = reste.split("\t");
      out.reponses.push({
        at: Date.parse(ts) || 0, modele: modele || "", ttl: ttl || "", effort: effort || "", id,
        u: { input_tokens: +entree || 0, cache_creation_input_tokens: +ecrit || 0, cache_read_input_tokens: +lu || 0, output_tokens: +sortie || 0 },
        ecrit1h: +ecrit1h || 0,
      });
    }
  }
  return out;
}

// ---- Tarifs (copiés tels quels de savvy-progress 1.2.1, prix catalogue du 2026-10-10) ---------
// $ par million de tokens : entrée, sortie, lecture du cache, écriture du cache (tarif 1 h).
const PRIX = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
];
// Haiku 5.5 : au-delà de 100 000 tokens de prompt (entrée, lectures et écritures du cache), ces prix.
const HAIKU_LONG_PROMPT = 100000;
const HAIKU_LONG = [0.5, 2.5, 0.05, 1];

export const prix = (modele, prompt = 0) => {
  const id = String(modele ?? "").toLowerCase();
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG;
  return PRIX.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8];
};
export const connu = (modele) => PRIX.some(([re]) => re.test(String(modele ?? "").toLowerCase()));

// Coût d'un usage. `requete` : une seule requête (le prix Haiku 5.5 dépend alors de la longueur du prompt).
export const cout = (modele, u, requete) => {
  const prompt = requete ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0;
  const [i, o, r, w] = prix(modele, prompt);
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6;
};

// Haiku 4.5 et les modèles Claude 3 : fenêtre de 200K ; les autres, Haiku 5.5 compris, 1M.
export const fenetre = (modele) => (/haiku-4|claude-3/i.test(String(modele ?? "")) ? 200000 : 1000000);

// "claude-opus-5-5" → "Opus 5.5".
export const nomModele = (id) => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(String(id ?? ""));
  if (!m) return String(id ?? "").replace(/^claude-/, "").replace(/\[.*\]$/, "") || "—";
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? "." + m[3] : ""}`;
};

// ---- Formats -------------------------------------------------------------------------------
export const tokens = (n) => (!isFinite(n) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const dollars = (usd) => (usd == null || !isFinite(usd) ? "—" : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`);
export const milliers = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// 45s, 3m 27s, 1h 05m
export const duree = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
};
// <1m, 42m, 2h 05m, 3d 4h
export const dureeCourte = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
};

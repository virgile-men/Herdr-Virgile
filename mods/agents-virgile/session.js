// Ce que le kanban dit de la session Claude Code d'un agent, lu sur sa machine : une commande sh par
// machine pour tous ses agents, qui parcourt chaque journal une fois.
// Les tarifs, la fenêtre et les noms de modèles sont copiés de ~/herdr-panneaux/panneaux/_commun/claude.js
// (2026-11-15) : à recopier si ces tarifs changent là-bas.

import { exec } from "herdr";

// Pour chaque argument "<pid>:<taille connue>" : la session Claude Code du processus (lui ou un
// enfant), puis, si son journal a changé de taille, ce qu'on y lit. Une ligne par chose vue :
//   S <pid> <id> <dossier> <journal> <taille> <version>   la session ; N <pid> : pas de session
//   K <pid>                                    journal inchangé : garder ce qu'on sait
//   M <pid> <modèle> <entrée> <écrit> <lu> <sortie> <réponses>   totaux par modèle
//   L <pid> <ts> <modèle> <entrée> <écrit> <lu> <sortie> <effort>   la dernière réponse
//   F <pid> <début> <dernière activité> <compactages> <demandes> <branche> <mode>
//   P <pid> {done,total,note}   le dernier pas de savvy-progress
//   A / U / X <pid> <ligne JSON>   le titre (ai-title), la dernière demande (last-prompt),
//                                  la dernière réponse en texte
const DETAILS = String.raw`
kids() { for k in $(pgrep -P "$1" 2>/dev/null); do echo "$k"; kids "$k"; done; }
for arg in "$@"; do
  pid=$(echo "$arg" | cut -d: -f1); known=$(echo "$arg" | cut -d: -f2); found=
  for p in "$pid" $(kids "$pid"); do
    j="$HOME/.claude/sessions/$p.json"; [ -f "$j" ] || continue
    id=$(sed -n 's/.*"sessionId":"\([0-9a-fA-F-]*\)".*/\1/p' "$j"); [ -n "$id" ] || continue
    cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$j")
    ver=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$j")
    f=; for x in "$HOME"/.claude/projects/*/"$id".jsonl; do [ -f "$x" ] && { f="$x"; break; }; done
    size=0; [ -n "$f" ] && size=$(wc -c < "$f" | tr -d ' ')
    printf 'S\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$id" "$cwd" "$f" "$size" "$ver"
    found=1
    if [ -z "$f" ]; then :
    elif [ "$size" = "$known" ]; then printf 'K\t%s\n' "$pid"
    else LC_ALL=C awk -v pid="$pid" '
function val(s, k) { if (match(s, "\"" k "\":\"[^\"]*\"")) return substr(s, RSTART + length(k) + 4, RLENGTH - length(k) - 5); return "" }
function num(s, k) { if (match(s, "\"" k "\":[0-9]+")) return substr(s, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0; return 0 }
function lastts(s,   t, r) { r = ""; t = s; while (match(t, /"timestamp":"[^"]*"/)) { r = substr(t, RSTART + 13, RLENGTH - 14); t = substr(t, RSTART + RLENGTH) } return r }
BEGIN { UC = "\"role\":\"user\",\"content\":\""; PK = "\"name\":\"mcp__savvy-progress__step\",\"input\":" }
{
  line = $0
  if (index(line, "{\"type\":\"") == 1) {
    if (index(line, "{\"type\":\"ai-title\"") == 1) { ttl = line; next }
    if (index(line, "{\"type\":\"last-prompt\"") == 1) { if (length(line) < 20000) lp = line; next }
    if (index(line, "{\"type\":\"permission-mode\"") == 1) { pm = val(line, "permissionMode"); next }
    if (index(line, "{\"type\":\"api-request") == 1) next
  }
  ts = val(line, "timestamp"); if (ts != "") { if (first == "") first = ts; at = ts }
  if (index(line, "\"subtype\":\"compact_boundary\"")) comp++
  b = val(line, "gitBranch"); if (b != "") br = b
  if (index(line, "\"type\":\"user\"") && (p = index(line, UC)) && !index(line, "\"isMeta\":true") && substr(line, p + length(UC), 1) != "<") asks++
  if (!index(line, "\"role\":\"assistant\"")) next
  if (index(line, "\"content\":[{\"type\":\"text\"") && length(line) < 60000) txt = line
  if (index(line, PK) && match(line, /"name":"mcp__savvy-progress__step","input":\{[^}]*\}/)) prog = substr(line, RSTART + length(PK), RLENGTH - length(PK))
  if (!(u = index(line, "\"usage\":{"))) next
  id = ""; if (match(line, /"id":"msg_[^"]*"/)) id = substr(line, RSTART + 6, RLENGTH - 7)
  if (id != "" && id == last) next
  last = id; us = substr(line, u); m = val(line, "model")
  i = num(us, "input_tokens"); w = num(us, "cache_creation_input_tokens"); r = num(us, "cache_read_input_tokens"); o = num(us, "output_tokens")
  if (m != "<synthetic>") { I[m] += i; W[m] += w; R[m] += r; O[m] += o; N[m]++ ; lm = m; li = i; lw = w; lr = r; lo = o; le = val(line, "effort"); lt = lastts(line) }
}
END {
  for (m in N) printf "M\t%s\t%s\t%.0f\t%.0f\t%.0f\t%.0f\t%.0f\n", pid, m, I[m], W[m], R[m], O[m], N[m]
  if (lm != "") printf "L\t%s\t%s\t%s\t%.0f\t%.0f\t%.0f\t%.0f\t%s\n", pid, lt, lm, li, lw, lr, lo, le
  printf "F\t%s\t%s\t%s\t%.0f\t%.0f\t%s\t%s\n", pid, first, at, comp, asks, br, pm
  if (prog != "") printf "P\t%s\t%s\n", pid, prog
  if (ttl != "") printf "A\t%s\t%s\n", pid, ttl
  if (lp != "") printf "U\t%s\t%s\n", pid, lp
  if (txt != "") printf "X\t%s\t%s\n", pid, txt
}' "$f"
    fi
    break
  done
  [ -n "$found" ] || printf 'N\t%s\n' "$pid"
done
true`;

const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

// La sortie de DETAILS → { pid: { ... } } (keep: true quand le journal n'a pas changé).
export function parse(text) {
  const out = {};
  const of = (pid) => (out[pid] ??= { models: [] });
  for (const l of String(text ?? "").split("\n")) {
    const f = l.split("\t");
    const [k, pid] = f;
    if (!pid) continue;
    const s = of(pid);
    if (k === "N") s.none = true;
    else if (k === "K") s.keep = true;
    else if (k === "S") Object.assign(s, { id: f[2], cwd: f[3], file: f[4], size: Number(f[5]) || 0, version: f[6] ?? "" });
    else if (k === "M") s.models.push({ model: f[2], u: { input_tokens: +f[3] || 0, cache_creation_input_tokens: +f[4] || 0, cache_read_input_tokens: +f[5] || 0, output_tokens: +f[6] || 0 }, n: +f[7] || 0 });
    else if (k === "L") s.last = { at: Date.parse(f[2]) || 0, model: f[3], input: +f[4] || 0, write: +f[5] || 0, read: +f[6] || 0, output: +f[7] || 0, effort: f[8] ?? "" };
    else if (k === "F") Object.assign(s, { first: Date.parse(f[2]) || 0, at: Date.parse(f[3]) || 0, compactions: +f[4] || 0, asks: +f[5] || 0, branch: f[6] ?? "", mode: f[7] ?? "" });
    else if (k === "P") s.progress = json(f.slice(2).join("\t"));
    else if (k === "A") s.title = json(f.slice(2).join("\t"))?.aiTitle ?? "";
    else if (k === "U") s.prompt = json(f.slice(2).join("\t"))?.lastPrompt ?? "";
    else if (k === "X") s.answer = (json(f.slice(2).join("\t"))?.message?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  }
  for (const s of Object.values(out)) {
    if (s.keep || s.none) continue;
    s.cost = s.models.reduce((n, m) => n + cout(m.model, m.u), 0);
    s.costKnown = s.models.every((m) => connu(m.model));
    s.answers = s.models.reduce((n, m) => n + m.n, 0);
    if (s.last) { s.context = s.last.input + s.last.write + s.last.read; s.window = fenetre(s.last.model); }
  }
  return out;
}

// Les sessions de ces agents ([{ address, pid }]), une commande par machine, en parallèle.
// `known` : adresse → ce qu'on savait (repris tel quel si le journal n'a pas grandi).
// Renvoie adresse → détails, { none } (pas de session) ou { error } (machine injoignable...).
export async function readSessions(list, known = {}) {
  const byMachine = new Map();
  for (const a of list) {
    const m = a.address.includes("/") ? a.address.slice(0, a.address.indexOf("/")) : null;
    if (!byMachine.has(m)) byMachine.set(m, []);
    byMachine.get(m).push(a);
  }
  const out = {};
  await Promise.all([...byMachine.entries()].map(async ([m, mine]) => {
    try {
      const args = mine.map((a) => `${a.pid}:${known[a.address]?.pid === a.pid ? known[a.address]?.size ?? -1 : -1}`);
      const r = await exec("sh", ["-c", DETAILS, "agents-kanban", ...args], { on: m, timeout: 60000 });
      const got = parse(r.stdout);
      for (const a of mine) {
        const s = got[String(a.pid)];
        if (!s) out[a.address] = { error: (r.stderr || "no response").trim().slice(0, 160) };
        else if (s.keep && known[a.address]) out[a.address] = known[a.address];
        else out[a.address] = { ...s, pid: a.pid };
      }
    } catch (e) {
      for (const a of mine) out[a.address] = { error: String(e).slice(0, 160) };
    }
  }));
  return out;
}

// ---- Tarifs (copiés de _commun/claude.js, eux-mêmes de savvy-progress 1.2.1, prix du 2026-10-10) --
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
const prix = (modele) => PRIX.find(([re]) => re.test(String(modele ?? "").toLowerCase()))?.[1] ?? [4, 20, 0.2, 8];
const connu = (modele) => PRIX.some(([re]) => re.test(String(modele ?? "").toLowerCase()));
const cout = (modele, u) => {
  const [i, o, r, w] = prix(modele);
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6;
};
// Haiku 4.5 et les modèles Claude 3 : fenêtre de 200K ; les autres, 1M.
const fenetre = (modele) => (/haiku-4|claude-3/i.test(String(modele ?? "")) ? 200000 : 1000000);

// "claude-opus-5-5" → "Opus 5.5".
export const nomModele = (id) => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(String(id ?? ""));
  if (!m) return String(id ?? "").replace(/^claude-/, "").replace(/\[.*\]$/, "") || "—";
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? "." + m[3] : ""}`;
};

export const tokens = (n) => (!isFinite(n) ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const dollars = (usd) => (usd == null || !isFinite(usd) ? "—" : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`);
// <1m, 42m, 2h 05m, 3d 4h
export const dureeCourte = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
};

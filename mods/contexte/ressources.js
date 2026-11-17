// Ce que consomme un agent maintenant : le processeur et la mémoire de son arbre de processus (le
// programme et tout ce qu'il a lancé : outils, serveurs MCP, shells) et son trafic réseau ; et ce
// que consomme sa machine entière (ou son conteneur LXC).
// Commun au panneau Session (section Ressources) et au kanban des agents (mods/agents-virgile, où il est
// copié à la main) : source ~/herdr-panneaux/panneaux/_commun/ressources.js, copiée dans contexte par vault-setup.py.
//
// Mesures sur la machine de l'agent, une commande sh par machine pour tous ses agents :
//   macOS : agent : ps (temps CPU cumulé, mémoire résidente), nettop (octets par processus depuis
//           son début : exact) ; machine : somme des %CPU de ps (moyenne glissante du noyau), vm_stat,
//           netstat de l'interface de la route par défaut ;
//   Linux : agent : /proc/<pid>/stat (temps CPU, mémoire résidente), ss (octets de chaque connexion
//           TCP encore ouverte : une connexion ouverte et fermée entre deux mesures n'est pas vue, le
//           réseau y est donc une estimation basse) ; machine : usage_usec du cgroup racine (le
//           conteneur LXC entier, ou l'hôte), /proc/meminfo, l'interface de la route par défaut.
// Les pourcentages et débits sont des différences entre deux mesures : la première ne donne que la
// mémoire. CPU d'un agent : 100 % = un cœur entier (comme top) ; CPU de la machine : 100 % = tous ses cœurs.

import { exec } from "herdr";

// Arguments : les pids racines. Sortie :
//   H <CPU cumulé en µs (Linux)> <%CPU instantané, somme sur les cœurs (macOS)> <charge 1 min> <interface> <octets reçus> <octets envoyés>
//   M <os> <cœurs> <mémoire totale> <mémoire disponible>           (octets)
//   P <racine> <secondes de CPU> <mémoire résidente> <processus>
//   N <racine> <clé> <octets envoyés> <octets reçus>                cumulés (une clé par processus
//                                                                    sous macOS, par connexion sous Linux)
export const RESSOURCES = String.raw`
export LC_ALL=C
roots="$*"
if [ -r /proc/self/stat ]; then
  # La machine entière (ou le conteneur LXC) : CPU cumulé du cgroup racine, sinon de /proc/stat ;
  # octets de l'interface de la route par défaut.
  if [ -r /sys/fs/cgroup/cpu.stat ]; then us=$(awk '/^usage_usec/ { print $2 }' /sys/fs/cgroup/cpu.stat)
  else us=$(awk '/^cpu / { printf "%.0f", ($2 + $3 + $4 + $7 + $8 + $9) * 1000000 / '"$(getconf CLK_TCK 2>/dev/null || echo 100)"' }' /proc/stat); fi
  if=$(awk '$2 == "00000000" { print $1; exit }' /proc/net/route)
  rx=0; tx=0; [ -n "$if" ] && rx=$(cat /sys/class/net/$if/statistics/rx_bytes 2>/dev/null || echo 0) && tx=$(cat /sys/class/net/$if/statistics/tx_bytes 2>/dev/null || echo 0)
  printf 'H\t%s\t\t%s\t%s\t%s\t%s\n' "$us" "$(cut -d' ' -f1 /proc/loadavg)" "$if" "$rx" "$tx"
  clk=$(getconf CLK_TCK 2>/dev/null || echo 100); pg=$(getconf PAGESIZE 2>/dev/null || echo 4096)
  ncpu=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)
  awk -v n="$ncpu" '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { printf "M\tlinux\t%s\t%.0f\t%.0f\n", n, t * 1024, a * 1024 }' /proc/meminfo
  { cat /proc/[0-9]*/stat 2>/dev/null; echo "@@NET"; ss -tinpH 2>/dev/null; } | LC_ALL=C awk -v roots="$roots" -v clk="$clk" -v pg="$pg" '
  BEGIN { split(roots, r, " ") }
  !net && $0 == "@@NET" { net = 1; tree(); next }
  !net {
    i = index($0, " ("); pid = substr($0, 1, i - 1)
    j = 0; s = $0; while ((k = index(substr(s, j + 1), ") ")) > 0) j += k
    split(substr($0, j + 2), f, " ")
    pp[pid] = f[2]; cpu[pid] = (f[12] + f[13]) / clk; rss[pid] = f[22] * pg
    next
  }
  # ss : une ligne par connexion, puis (en retrait) ses compteurs.
  /^[^ \t]/ { owner = ""; key = $4 " " $5; s = $0
    while (match(s, /pid=[0-9]+/)) { p = substr(s, RSTART + 4, RLENGTH - 4); if (p in of) { owner = of[p]; break } s = substr(s, RSTART + RLENGTH) }
    next }
  owner != "" { sent = 0; recv = 0
    if (match($0, /bytes_sent:[0-9]+/)) sent = substr($0, RSTART + 11, RLENGTH - 11)
    if (match($0, /bytes_received:[0-9]+/)) recv = substr($0, RSTART + 15, RLENGTH - 15)
    printf "N\t%s\t%s\t%.0f\t%.0f\n", owner, key, sent, recv; owner = "" }
  function tree(   p, q, x, k) {
    for (k in r) { want[r[k]] = 1 }
    for (p in pp) {
      q = p
      for (x = 0; x < 64 && q != "" && q > 1; x++) { if (q in want) { of[p] = q; break } q = pp[q] }
    }
    for (p in of) { C[of[p]] += cpu[p]; R[of[p]] += rss[p]; K[of[p]]++ }
    for (k in r) printf "P\t%s\t%.2f\t%.0f\t%d\n", r[k], C[r[k]], R[r[k]], K[r[k]]
  }
  END { if (!net) tree() }'
else
  # La machine entière : somme des %CPU de ps (moyenne glissante du noyau), octets de l'interface
  # de la route par défaut (netstat : les colonnes comptées depuis la fin de la ligne <Link#>).
  if=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')
  io=$(netstat -ibn -I "$if" 2>/dev/null | awk '/<Link#/ { print $(NF - 4) "\t" $(NF - 1); exit }')
  [ -n "$io" ] || io=$(printf '0\t0')
  printf 'H\t\t%s\t%s\t%s\t%s\n' "$(ps -A -o %cpu= | awk '{ s += $1 } END { printf "%.1f", s }')" "$(sysctl -n vm.loadavg | awk '{ print $2 }')" "$if" "$io"
  pg=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)
  vm_stat 2>/dev/null | awk -v n="$(sysctl -n hw.ncpu)" -v t="$(sysctl -n hw.memsize)" -v pg="$pg" '
    /Pages free/ { a += $3 } /Pages inactive/ { a += $3 } /Pages speculative/ { a += $3 } /Pages purgeable/ { a += $3 }
    END { printf "M\tmacos\t%s\t%.0f\t%.0f\n", n, t, a * pg }'
  { ps -axo pid=,ppid=,time=,rss= 2>/dev/null; echo "@@NET"; nettop -P -L 1 -n -x -J bytes_in,bytes_out 2>/dev/null; } | LC_ALL=C awk -v roots="$roots" '
  BEGIN { split(roots, r, " ") }
  !net && $0 == "@@NET" { net = 1; tree(); next }
  !net {
    # TIME : [jours-][heures:]minutes:secondes.centièmes
    t = $3; d = 0; if ((i = index(t, "-")) > 0) { d = substr(t, 1, i - 1); t = substr(t, i + 1) }
    n = split(t, u, ":"); s = u[n] + 0; if (n > 1) s += u[n - 1] * 60; if (n > 2) s += u[n - 2] * 3600
    pp[$1] = $2; cpu[$1] = s + d * 86400; rss[$1] = $4 * 1024
    next
  }
  # nettop : nom.pid,octets reçus,octets envoyés,
  { n = split($0, f, ","); if (n < 3) next; m = f[1]; i = 0; while (match(substr(m, i + 1), /\./)) i += RSTART
    if (i == 0) next; p = substr(m, i + 1); if (p in of) printf "N\t%s\tp%s\t%.0f\t%.0f\n", of[p], p, f[3], f[2] }
  function tree(   p, q, x, k) {
    for (k in r) { want[r[k]] = 1 }
    for (p in pp) {
      q = p
      for (x = 0; x < 64 && q != "" && q > 1; x++) { if (q in want) { of[p] = q; break } q = pp[q] }
    }
    for (p in of) { C[of[p]] += cpu[p]; R[of[p]] += rss[p]; K[of[p]]++ }
    for (k in r) printf "P\t%s\t%.2f\t%.0f\t%d\n", r[k], C[r[k]], R[r[k]], K[r[k]]
  }
  END { if (!net) tree() }'
fi
true`;

// La sortie de RESSOURCES → { machine: { os, cpus, total, dispo, usec, pct, charge, iface, rx, tx }, pids: { pid: { cpu, rss, nproc, net: { clé: [envoyés, reçus] } } } }.
export function lireRessources(texte) {
  const out = { machine: null, pids: {} };
  let h = null;
  for (const l of String(texte ?? "").split("\n")) {
    const f = l.split("\t");
    // (Une virgule décimale, si la machine écrit les nombres à la française.)
    const n = (x) => (x == null || x === "" ? null : Number(String(x).replace(",", ".")));
    if (f[0] === "H") h = { usec: n(f[1]), pct: n(f[2]), charge: n(f[3]), iface: f[4] || "", rx: +f[5] || 0, tx: +f[6] || 0 };
    else if (f[0] === "M") out.machine = { os: f[1], cpus: +f[2] || 1, total: +f[3] || 0, dispo: +f[4] || 0 };
    else if (f[0] === "P") out.pids[f[1]] = { ...(out.pids[f[1]] ?? { net: {} }), cpu: +f[2] || 0, rss: +f[3] || 0, nproc: +f[4] || 0 };
    else if (f[0] === "N") { const p = (out.pids[f[1]] ??= { net: {} }); p.net[f[2]] = [+f[3] || 0, +f[4] || 0]; }
  }
  if (out.machine && h) Object.assign(out.machine, h);
  return out;
}

// Les mesures successives ; un agent par `cle` (son adresse) et `pid` (sa racine), une machine par son nom.
export class Mesures {
  constructor() { this.prec = {}; this.precM = {}; }

  // Une mesure brute d'agent → { cpu (% d'un cœur, null à la première), rss, nproc, rx, tx (octets/s,
  // null à la première), machine }.
  calcule(cle, pid, brut, machine, at) {
    const p = this.prec[cle];
    const same = p && p.pid === pid;
    const dt = same ? (at - p.at) / 1000 : 0;
    let rx = null, tx = null, cpu = null;
    if (same && dt > 0.2) {
      cpu = Math.max(0, (brut.cpu - p.cpu) / dt * 100);
      // Par clé (processus ou connexion) : une nouvelle compte en entier ; un compteur qui recule
      // (processus ou connexion réutilisés) repart de zéro.
      let s = 0, r = 0;
      for (const [k, [es, er]] of Object.entries(brut.net)) {
        const [ps, pr] = p.net[k] ?? [0, 0];
        s += es >= ps ? es - ps : es; r += er >= pr ? er - pr : er;
      }
      tx = s / dt; rx = r / dt;
    }
    this.prec[cle] = { pid, at, cpu: brut.cpu, net: brut.net };
    return { cpu, rss: brut.rss, nproc: brut.nproc, rx, tx, machine, at };
  }

  // La machine entière → { os, cpus, cpu (% de tous ses cœurs), utilisee, total, charge, iface, rx, tx }.
  machine(nom, m, at) {
    if (!m) return null;
    const p = this.precM[nom ?? ""];
    const dt = p ? (at - p.at) / 1000 : 0;
    const ok = p && dt > 0.2;
    let cpu = m.pct != null ? m.pct / m.cpus : null;
    if (m.usec != null) cpu = ok && m.usec >= p.usec ? (m.usec - p.usec) / 1e6 / dt / m.cpus * 100 : null;
    const rate = (a, b) => (ok && p.iface === m.iface ? (a >= b ? a - b : a) / dt : null);
    const out = { os: m.os, cpus: m.cpus, cpu: cpu == null ? null : Math.min(100, Math.max(0, cpu)), utilisee: Math.max(0, m.total - m.dispo), total: m.total,
      charge: m.charge, iface: m.iface, rx: ok ? rate(m.rx, p.rx) : null, tx: ok ? rate(m.tx, p.tx) : null, at };
    this.precM[nom ?? ""] = { at, usec: m.usec, rx: m.rx, tx: m.tx, iface: m.iface };
    return out;
  }

  oublie(garder) { for (const k of Object.keys(this.prec)) if (!garder.has(k)) delete this.prec[k]; }
}

// Mesure ces agents ([{ cle, pid, machine }]) et leurs machines : une commande par machine, en parallèle.
// Renvoie { agents: cle → mesure ou { erreur }, machines: nom ("" pour celle-ci) → mesure ou { erreur } }.
export async function mesurer(mesures, liste) {
  const parMachine = new Map();
  for (const a of liste) {
    if (!parMachine.has(a.machine ?? null)) parMachine.set(a.machine ?? null, []);
    parMachine.get(a.machine ?? null).push(a);
  }
  const out = { agents: {}, machines: {} };
  await Promise.all([...parMachine.entries()].map(async ([m, siens]) => {
    try {
      const r = await exec("sh", ["-c", RESSOURCES, "ressources", ...siens.map((a) => String(a.pid))], { on: m, timeout: 20000 });
      const lu = lireRessources(r.stdout);
      const at = Date.now();
      out.machines[m ?? ""] = mesures.machine(m, lu.machine, at) ?? { erreur: (r.stderr || "no response").trim().slice(0, 160) };
      for (const a of siens) {
        const b = lu.pids[String(a.pid)];
        out.agents[a.cle] = b && b.nproc ? mesures.calcule(a.cle, a.pid, b, lu.machine, at) : { erreur: "process not found" };
      }
    } catch (e) {
      out.machines[m ?? ""] = { erreur: String(e).slice(0, 160) };
      for (const a of siens) out.agents[a.cle] = { erreur: String(e).slice(0, 160) };
    }
  }));
  return out;
}

// ---- Formats -------------------------------------------------------------------------------
// (Le nom est resté ; les nombres s'écrivent désormais avec un point décimal, à l'anglaise.)
const virgule = (x) => String(x);
export const octets = (n) => (n == null || !isFinite(n) ? "—" : n >= 1e9 ? `${virgule((n / 1e9).toFixed(1))} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${Math.round(n)} B`);
export const debit = (n) => (n == null || !isFinite(n) ? "—" : n >= 1e6 ? `${virgule((n / 1e6).toFixed(1))} MB/s` : n >= 1e3 ? `${virgule((n / 1e3).toFixed(n >= 1e4 ? 0 : 1))} KB/s` : `${Math.round(n)} B/s`);
export const pourcent = (x) => (x == null || !isFinite(x) ? "—" : `${x >= 10 ? Math.round(x) : virgule(x.toFixed(1))}%`);
const enCours = (x, f) => (x == null ? "…" : f(x));
export const reseau = (v) => `↓ ${enCours(v.rx, debit)} ↑ ${enCours(v.tx, debit)}`;

// Les trois valeurs d'un agent en une ligne : « CPU 12% · RAM 488 MB · ↓ 3.1 KB/s ↑ 0.4 KB/s ».
export const resume = (v) => (!v || v.erreur ? null : `CPU ${enCours(v.cpu, pourcent)} · RAM ${octets(v.rss)} · ${reseau(v)}`);
// Celles d'une machine : « CPU 23% · RAM 75% · ↓ 2 KB/s ↑ 600 KB/s ».
export const resumeMachine = (m) => (!m || m.erreur ? null : `CPU ${enCours(m.cpu, pourcent)} · RAM ${pourcent(m.utilisee / (m.total || 1) * 100)} · ${reseau(m)}`);

// Le détail d'un agent en infobulle : processus, machine, et comment c'est mesuré.
export const detail = (v) => {
  if (!v || v.erreur) return v?.erreur ?? "";
  const m = v.machine;
  const lignes = [`${v.nproc} process${v.nproc === 1 ? "" : "es"} (the agent and what it started)`, "CPU: 100% = one full core"];
  if (m) lignes.push(`Machine: ${m.cpus} core${m.cpus === 1 ? "" : "s"}, RAM ${octets(m.total - m.dispo)} used of ${octets(m.total)} (${pourcent((1 - m.dispo / (m.total || 1)) * 100)})`);
  lignes.push(m?.os === "linux" ? "Network: TCP connections still open (a low estimate)" : "Network: the process's own bytes (nettop)");
  return lignes.join("\n");
};

// Le détail d'une machine en infobulle.
export const detailMachine = (m) => {
  if (!m || m.erreur) return m?.erreur ?? "";
  return [`${m.cpus} core${m.cpus === 1 ? "" : "s"} · CPU: 100% = all cores${m.charge != null ? ` · load ${virgule(m.charge.toFixed(2))}` : ""}`,
    `RAM ${octets(m.utilisee)} used of ${octets(m.total)}`,
    `Network: interface ${m.iface || "?"} (default route)`,
    m.os === "linux" ? "CPU: root cgroup (the whole LXC container, or the host)" : "CPU: sum of ps %CPU (moving average)"].join("\n");
};

// Profile: the harness-profiler trace of the Claude Code session the Session panel follows: which skills
// and agents ran, which context each one opened, how long they took, what they spent in tokens, what
// failed and when the history was compacted. Shared by Session's Profile section and the Profile popup.
// Source: ~/herdr-panneaux/panneaux/_commun/profile.js, copied into both mods by vault-setup.py (a mod
// cannot import anything outside its own folder).
//
// The plugin appends one JSON line per tool call to <git root of the launch folder, else that folder>/
// .harness-profile/<session>.jsonl. The launch folder is the cwd in ~/.claude/sessions/<pid>.json, which
// session() in claude.js returns. Reads happen in chunks (only what the file gained), on the agent's
// machine, and only when asked.
//
// The context model (uniqueCalls, withStop, contextsOf, buildForest) is ported from plugin/libexec/hp.js
// 0.2.2 of https://github.com/afurmanov/harness-profiler (MIT, Copyright (c) 2026 Aleksandr Furmanov;
// see LICENSE-harness-profiler).
//
// "Open in browser" renders the plugin's own page (`hp.sh tree <session> --format html`) on the agent's
// machine (its token counts come from that machine's transcripts), writes it to $TMPDIR on this Mac and
// opens it. The native sequence diagram is in the profile mod (sequence.js).
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, settings } from "herdr";
import { sh, AGREGE } from "./claude.js";

// ---- Where the trace and the profiler are -----------------------------------------------------
// Args: <launch folder> <session>. Prints "<root>\t<trace>\t<size or -1>\t<hp.sh or empty>".
// hp.sh: the plugin's first, like the show-profile skill, else the copy `init` committed to the repo.
const LOCATE = String.raw`
d="$1"; id="$2"
[ -n "$d" ] || exit 0
r="$d"
while [ -n "$r" ] && [ "$r" != "/" ] && [ ! -e "$r/.git" ]; do r=$(dirname "$r"); done
[ -e "$r/.git" ] || r="$d"
f="$r/.harness-profile/$id.jsonl"
hp=""
[ -f "$r/.claude/harness-profiler/hp.sh" ] && hp="$r/.claude/harness-profiler/hp.sh"
j="$HOME/.claude/plugins/installed_plugins.json"
if [ -f "$j" ]; then
  p=$(tr ',{}' '\n\n\n' < "$j" | sed -n 's/.*"installPath": *"\([^"]*harness-profiler[^"]*\)".*/\1/p' | head -1)
  [ -n "$p" ] && [ -f "$p/libexec/hp.sh" ] && hp="$p/libexec/hp.sh"
fi
s=-1; [ -f "$f" ] && s=$(wc -c < "$f" | tr -d ' ')
printf '%s\t%s\t%s\t%s\n' "$r" "$f" "$s" "$hp"`;

// What the trace gained since byte <from>, in whole lines: "E <end> <start>" then the lines.
// "E -1": the file is gone.
const READ = AGREGE + String.raw`
f="$1"; o="$2"
[ -f "$f" ] || { echo "E -1 0"; exit 0; }
[ "$(wc -c < "$f" | tr -d ' ')" -lt "$o" ] && o=0
e=$(fin_entiere "$f" "$o"); [ "$e" -lt "$o" ] && e="$o"
echo "E $e $o"
[ "$e" -gt "$o" ] && morceau "$f" "$o" "$e"
true`;

// Each subagent's tokens, summed from its transcript the way hp does it (once per message):
// "<id>\t<new>\t<cached>\t<out>\t<model calls>". Arg: <session>/subagents.
const SPEND = String.raw`
d="$1"
[ -d "$d" ] || exit 0
for f in "$d"/agent-*.jsonl; do
  [ -f "$f" ] || continue
  id=${"$"}{f##*/agent-}; id=${"$"}{id%.jsonl}
  LC_ALL=C awk -v id="$id" '
function num(s, k) { if (match(s, "\"" k "\":[0-9]+")) return substr(s, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0; return 0 }
(index($0, "\"type\":\"assistant\"") || index($0, "\"role\":\"assistant\"")) && (u = index($0, "\"usage\":{")) {
  mid = ""; if (match($0, /"id":"msg_[^"]*"/)) mid = substr($0, RSTART + 6, RLENGTH - 7)
  if (mid != "" && (mid in seen)) next
  if (mid != "") seen[mid] = 1
  us = substr($0, u)
  n += num(us, "input_tokens") + num(us, "cache_creation_input_tokens"); c += num(us, "cache_read_input_tokens"); o += num(us, "output_tokens"); k++
}
END { if (k) printf "%s\t%d\t%d\t%d\t%d\n", id, n, c, o, k }' "$f"
done
true`;

// Runs on this Mac. Args: <machine or empty> <hp.sh> <session> <root>. The page is rendered where the
// agent is (hc exec), written to $TMPDIR, then opened; its path goes to stdout.
const BROWSER_PAGE = String.raw`
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
m="$1"; hp="$2"; id="$3"; d="$4"
f="${"$"}{TMPDIR:-/tmp}/herdr-profile-$(printf %s "$id" | cut -c1-8)-$(date +%s).html"
if [ -n "$m" ]; then
  hc exec --on "$m" sh -c 'cd "$1" && exec sh "$2" tree "$3" --format html' profile "$d" "$hp" "$id" > "$f" || exit 1
else
  (cd "$d" && exec sh "$hp" tree "$id" --format html) > "$f" || exit 1
fi
[ -s "$f" ] || { echo "empty page" >&2; exit 1; }
if command -v open >/dev/null 2>&1; then open "$f"; else xdg-open "$f" >/dev/null 2>&1 & fi
echo "$f"`;

// ---- The model, ported from hp.js -------------------------------------------------------------
export const MAIN = "main";
const HANDBACK = "SubagentHandback";
const PARENT_TOOLS = ["Skill", "Agent"];
const COPY_AGENT = "fork";        // a subagent that starts with a copy of its caller's history
const DEFAULT_AGENT = "general-purpose";
const DUPLICATE_EVENT_MS = 5000;
const LAUNCH_NOTICE = /^Running in the background as @/;

export const startOf = (r) => Date.parse(r.at) - (r.duration_ms || 0);
export const contextOf = (r) => r.agent_id || MAIN;
export const shortId = (id) => (id === MAIN ? MAIN : String(id).slice(0, 6));
const KIND_WORDS = { Skill: "skill", Agent: "agent" };
export const kindWord = (tool) => KIND_WORDS[tool] || tool;

// A background subagent stops each time it runs out of work; its last SubagentStop is the one that ends it.
function subagentStops(records) {
  const stops = new Map();
  for (const r of records) if (r.event === "SubagentStop" && r.agent_id) stops.set(r.agent_id, { ...stops.get(r.agent_id), ...r });
  return stops;
}

// A background call returns at once: it ends at its SubagentStop, and its result is what it handed back
// (SubagentHandback). Without a stop it is still running.
function withStop(record, stop, handback) {
  const { result, ...launched } = record;
  const call = LAUNCH_NOTICE.test(result || "") ? { ...launched, background: true } : record;
  if (!stop) return call.background ? { ...call, running: true } : call;
  const merged = { ...call, child_agent_type: call.child_agent_type || stop.agent_type };
  if (!call.background) return merged;
  return { ...merged, at: stop.at, duration_ms: Math.max(0, Date.parse(stop.at) - startOf(call)), result: handback || call.result || stop.result };
}

// The plugin and a committed hook on one machine record everything twice.
function uniqueCalls(records, stops) {
  const seen = new Set();
  const handbacks = new Map(records.filter((r) => r.tool === HANDBACK && r.agent_id && r.result).map((r) => [r.agent_id, r.result]));
  return records.filter((r) => {
    if (!r.tool) return false;
    if (!r.tool_use_id) return true;
    if (seen.has(r.tool_use_id)) return false;
    seen.add(r.tool_use_id);
    return true;
  }).map((r) => withStop(r, stops.get(r.child_agent_id), handbacks.get(r.child_agent_id)));
}

function uniqueEvents(records) {
  const kept = [];
  for (const r of records) {
    if (r.tool || !r.event) continue;
    const at = Date.parse(r.at);
    const twin = kept.find((k) => k.event === r.event && k.agent_id === r.agent_id
      && k.trigger === r.trigger && k.source === r.source && Math.abs(Date.parse(k.at) - at) < DUPLICATE_EVENT_MS);
    if (!twin) kept.push(r);
  }
  return kept;
}

// The contexts: main, then one per subagent (forked skill or Agent), in the order they started. A copy
// (fork) keeps its parent's hue, a fresh context takes the next one. Plus the compactions.
function contextsOf(calls, records) {
  const list = [{ id: MAIN, parent: undefined, kind: "root", name: MAIN, tool: null }];
  const known = new Set([MAIN]);
  for (const r of calls) {
    if (!r.child_agent_id || known.has(r.child_agent_id)) continue;
    known.add(r.child_agent_id);
    list.push({ id: r.child_agent_id, parent: contextOf(r), kind: r.child_agent_type === COPY_AGENT ? "copy" : "fresh",
      name: r.name, tool: r.tool, start: startOf(r), end: Date.parse(r.at) });
  }
  for (const r of calls) {
    const id = contextOf(r);
    if (known.has(id)) continue;
    known.add(id);
    list.push({ id, parent: undefined, kind: "fresh", name: r.agent_type || DEFAULT_AGENT, tool: "Agent" });
  }
  const started = list.slice(1).sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));
  list.splice(1, started.length, ...started);
  const hues = new Map();
  let next = 0;
  for (const c of list) {
    c.hue = c.kind === "copy" && hues.has(c.parent) ? hues.get(c.parent) : next++;
    hues.set(c.id, c.hue);
  }
  // A PreCompact opens a compaction and the PostCompact after it closes it; a lone PostCompact counts too.
  const compactions = [];
  let open;
  for (const e of uniqueEvents(records)) {
    if (e.event === "PreCompact") { open = { kind: "compact", ctx: contextOf(e), at: Date.parse(e.at), trigger: e.trigger }; compactions.push(open); }
    else if (e.event === "PostCompact") {
      if (!open) compactions.push({ kind: "compact", ctx: contextOf(e), at: Date.parse(e.at), trigger: e.trigger });
      open = undefined;
    }
  }
  return { list, compactions };
}

// The tree: each call under the call that opened its context. A context whose call is not in the trace
// (the session started before the plugin) gets a placeholder at the root.
function buildForest(calls, compactions) {
  const nodes = calls.map((record, index) => ({ record, index, start: startOf(record), children: [] }));
  const byChild = new Map(nodes.filter((n) => n.record.child_agent_id).map((n) => [n.record.child_agent_id, n]));
  const placeholders = new Map();
  const roots = [];
  const containerOf = (agent, start, index, agentType) => {
    if (!agent) return roots;
    let p = byChild.get(agent);
    if (!p) {
      p = placeholders.get(agent);
      if (!p) { p = { placeholder: true, agent, agentType, start, index, children: [] }; placeholders.set(agent, p); roots.push(p); }
      p.start = Math.min(p.start, start);
    }
    return p.children;
  };
  for (const n of nodes) containerOf(n.record.agent_id, n.start, n.index, n.record.agent_type).push(n);
  for (const k of compactions) containerOf(k.ctx === MAIN ? undefined : k.ctx, k.at, Infinity).push({ marker: k, start: k.at, index: Infinity, children: [] });
  const sort = (l) => { l.sort((a, b) => a.start - b.start || a.index - b.index); for (const n of l) sort(n.children); };
  sort(roots);
  return roots;
}

// Each context's tokens: from the transcripts while they exist (read), else what capture noted
// (child_spend, then the last SubagentStop), like hp. Main's own spend is not counted here (see Cache
// and Context).
function spendOf(calls, stops, read) {
  const d = new Map();
  for (const r of calls) if (r.child_agent_id && r.child_spend) d.set(r.child_agent_id, r.child_spend);
  for (const s of stops.values()) if (s.spend) d.set(s.agent_id, s.spend);
  for (const [id, sp] of read ?? []) d.set(id, sp);
  return d;
}

export function buildModel(records, read) {
  const stops = subagentStops(records);
  const calls = uniqueCalls(records, stops);
  const { list, compactions } = contextsOf(calls, records);
  const skills = calls.filter((r) => r.tool === "Skill");
  return {
    calls, contexts: list, byId: new Map(list.map((c) => [c.id, c])), compactions,
    spend: spendOf(calls, stops, read),
    forest: buildForest(calls, compactions),
    stats: {
      calls: calls.length,
      contexts: list.length,
      inline: skills.filter((r) => !r.child_agent_id).length,
      forked: skills.filter((r) => r.child_agent_id).length,
      agents: calls.filter((r) => r.tool === "Agent").length,
      compactions: compactions.length,
      failures: calls.filter((r) => r.ok === false),
      running: calls.filter((r) => r.running).length,
    },
  };
}

// The rows to show, flat: [node, depth]. Without `all`, only skills, agents, contexts without a recorded
// parent and compactions, like `hp tree` without --verbose.
export function flatten(m, all) {
  const out = [];
  const walk = (l, depth) => {
    for (const n of l) {
      if (!(all || n.placeholder || n.marker || PARENT_TOOLS.includes(n.record.tool))) continue;
      out.push([n, depth]);
      walk(n.children, depth + 1);
    }
  };
  walk(m.forest, 0);
  return out;
}

// ---- Reading ----------------------------------------------------------------------------------
export class Profile {
  constructor() { this.target(null); }

  // The session to follow ({ id, cwd, machine, file, … } from claude.js), or null. Same session: keep what was read.
  target(s) {
    const key = s ? `${s.machine ?? ""}|${s.id}|${s.cwd}` : null;
    if (key && key === this.key) { this.session = s; return; }
    this.key = key; this.session = s;
    this.root = null; this.file = null; this.hp = null; this.size = -1; this.located = false;
    this.offset = 0; this.records = []; this.memo = null;
    this.loaded = false; this.error = null; this.lastRead = 0;
    this.spendRead = new Map(); this.lastSpend = 0;  // tokens read from the subagent transcripts
    this.ctxLines = 0; this.ctxLinesAtSpend = -1;    // lines that open or close a context: seen, and at the last spend read
  }

  // Due for a read? Every 3 s once the trace exists, every 10 s until it does.
  due(now) {
    return Boolean(this.session) && now - this.lastRead >= (this.size >= 0 ? 3000 : 10000);
  }

  async read() {
    const s = this.session, key = this.key;
    if (!s) return;
    this.lastRead = Date.now();
    if (!s.cwd) { this.error = "Unknown launch folder."; this.loaded = true; return; }
    if (!this.located || this.size < 0) {
      const r = await sh(LOCATE, [s.cwd, s.id], s.machine, 20000);
      if (this.key !== key) return;
      const [root, file, size, hp] = (r.stdout.trim().split("\n").pop() ?? "").split("\t");
      this.root = root || null; this.file = file || null; this.hp = hp || null;
      this.size = file ? Number(size) : -1; this.located = true;
      if (!(this.size >= 0)) { this.loaded = true; this.error = null; return; }
    }
    const r = await sh(READ, [this.file, String(this.offset)], s.machine, 30000);
    if (this.key !== key) return;
    const lines = r.stdout.split("\n");
    const [, end, start] = (lines.shift() ?? "").split(" ").map(Number);
    if (!(end >= 0)) { this.size = -1; this.located = false; this.offset = 0; this.records = []; this.memo = null; this.loaded = true; return; }
    if (start < this.offset) { this.records = []; this.memo = null; this.ctxLines = 0; this.ctxLinesAtSpend = -1; } // the file started over
    let added = 0;
    for (const l of lines) {
      if (!l.trim()) continue;
      let rec;
      try { rec = JSON.parse(l); } catch { continue; } // a torn line is skipped, like hp does
      this.records.push(rec); added++;
      if (rec.child_agent_id || rec.event === "SubagentStop") this.ctxLines++;
    }
    if (added) this.memo = null;
    this.offset = end; this.size = end; this.loaded = true; this.error = null;
    // Subagent tokens (every transcript, read whole): only when a context opened or closed since the last
    // read, or every 15 s while a background context is still running. Not on every tool call.
    const now = Date.now();
    if (s.file && (this.ctxLinesAtSpend !== this.ctxLines || (this.model().stats.running && now - this.lastSpend >= 15000))) {
      this.lastSpend = now;
      const n = this.ctxLines;
      const d = await sh(SPEND, [s.file.replace(/\.jsonl$/, "") + "/subagents"], s.machine, 30000);
      if (this.key !== key) return;
      const spend = new Map();
      for (const l of d.stdout.split("\n")) {
        const [id, nw, cached, out, calls] = l.split("\t");
        if (id && calls) spend.set(id, { new: Number(nw), cached: Number(cached), out: Number(out), calls: Number(calls) });
      }
      this.spendRead = spend; this.ctxLinesAtSpend = n; this.memo = null;
    }
  }

  model() { return (this.memo ??= buildModel(this.records, this.spendRead)); }

  // Why there is nothing to show, or null.
  empty() {
    const machine = this.session?.machine ?? "this Mac";
    if (this.error) return this.error;
    if (!this.loaded) return "Reading the trace…";
    if (this.size < 0 && !this.hp) return `harness-profiler is not installed on ${machine}.`;
    if (this.size < 0 || !this.model().stats.calls)
      return "No calls recorded for this session. If it started before the plugin was installed, run /reload-plugins in it.";
    return null;
  }

  // Opens the plugin's own page in the browser. Resolves to null, or the failure message.
  async openInBrowser() {
    const s = this.session;
    if (!s) return "No session followed.";
    if (!this.hp || !this.root) return `harness-profiler not found on ${s.machine ?? "this Mac"}.`;
    const r = await exec("sh", ["-c", BROWSER_PAGE, "profile", s.machine ?? "", this.hp, s.id, this.root], { timeout: 90000 });
    return r.code === 0 ? null : (r.stderr || r.stdout || "failed").trim().split("\n").pop().slice(0, 200);
  }
}

// ---- Display ----------------------------------------------------------------------------------
// The diagram's palette (view.html), so a context has the same color here and in the browser page.
const HUES_DARK = ["#e07d7b", "#4fb0b8", "#d6a542", "#9b89e0", "#6cc07a", "#dd7fae", "#6f9ee0", "#c29a76"];
const HUES_LIGHT = ["#c55e5d", "#2f7f86", "#b07d1f", "#6c58b5", "#3f8a4a", "#b0517f", "#3d6fb3", "#8a6a4f"];
export const hueOf = (m, ctx) => {
  const p = settings()?.dark === false ? HUES_LIGHT : HUES_DARK;
  return p[(m.byId.get(ctx)?.hue ?? 0) % p.length];
};

export const count = (n) => (!isFinite(n) ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n)));
export const took = (ms) => {
  if (!isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
};
export const clock = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return isFinite(ms) ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : "";
};
// Square-root scale, like hp: the longest call fills the bar and short ones stay visible.
export const share = (ms, longest) => (!longest || !ms ? 0 : Math.sqrt(Math.min(ms, longest) / longest));

// What a row says: its name, kind, where it ran, and the full tooltip.
export function describe(m, n) {
  if (n.placeholder) {
    const name = n.agentType || DEFAULT_AGENT;
    return { name, kind: "agent", ctx: n.agent, where: `context ${shortId(n.agent)}`, info: `${name} (agent) · context ${shortId(n.agent)}\nThe call that started it is not in the trace.` };
  }
  if (n.marker) {
    const k = n.marker;
    return { name: `compaction${k.trigger ? ` (${k.trigger})` : ""}`, kind: "", ctx: k.ctx, where: shortId(k.ctx), info: `${shortId(k.ctx)} compacted at ${clock(k.at)}` };
  }
  const r = n.record, child = r.child_agent_id;
  const name = r.name || kindWord(r.tool);
  const childCtx = child ? m.byId.get(child) : null;
  const where = child
    ? [`new context ${shortId(child)}`, childCtx?.kind === "copy" ? `copy of ${shortId(contextOf(r))}` : "", r.background ? "background" : ""].filter(Boolean).join(", ")
    : r.tool === "Skill" ? "inline" : "";
  const sp = child ? m.spend.get(child) : null;
  const info = [
    `${name} (${kindWord(r.tool)})${where ? ` · ${where}` : ""}${r.ok === false ? " · failed" : ""}`,
    `Started ${clock(n.start)} · ${r.running ? "running" : took(r.duration_ms || 0)} · called by ${shortId(contextOf(r))}`,
    r.args && r.args !== r.name ? `Arguments: ${r.args}` : "",
    r.result ? `Result: ${r.result}` : "",
    sp ? `Tokens: ${count(sp.new)} new · ${count(sp.cached)} cached · ${count(sp.out)} out (${sp.calls} model call${sp.calls === 1 ? "" : "s"})` : "",
    isFinite(r.context_tokens) ? `Caller's context: ${count(r.context_tokens)} tokens` : "",
  ].filter(Boolean).join("\n");
  return { name, kind: kindWord(r.tool), ctx: child || contextOf(r), where, info, sp, inline: r.tool === "Skill" && !child, opens: Boolean(child) };
}

// A row's bullet: a diamond for an inline skill, a square for a new context, a dot for other calls, in
// the context's hue.
export function bullet(t, m, n, d) {
  const c = hueOf(m, d.ctx);
  if (n.marker) return div().w(10).flex_none().text_size(11).text_color(t.dim).child("⟲");
  if (d.inline) return div().w(10).flex_none().text_size(10).text_color(c).child("◆");
  if (d.opens || n.placeholder) return div().w(10).flex_none().flex().items_center().child(div().size(8).rounded(2).bg(c));
  return div().w(10).flex_none().flex().items_center().justify_center().child(div().size(4).rounded(2).bg(c));
}

// The summary: calls, contexts, skills, agents, compactions, running.
export function summary(st) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return [
    n(st.calls, "call", "calls"),
    n(st.contexts, "context", "contexts"),
    st.inline + st.forked ? `${n(st.inline + st.forked, "skill", "skills")} (${st.inline} inline, ${st.forked} forked)` : "",
    st.agents ? n(st.agents, "agent", "agents") : "",
    st.compactions ? n(st.compactions, "compaction", "compactions") : "",
    st.running ? `${st.running} running` : "",
  ].filter(Boolean).join(" · ");
}

// A row's duration bar.
export function bar(t, color, p, width) {
  return div().w(width).h(4).flex_none().rounded(2).bg(t.raised)
    .child(div().h_full().rounded(2).bg(color).w(`${p > 0 ? Math.max(4, Math.round(p * 100)) : 0}%`));
}

// The failures, one row each (the last three).
export function failureRows(t, m) {
  const e = m.stats.failures;
  if (!e.length) return [];
  return [v_flex().flex_none().mx(14).mt(4).gap(2).children(e.slice(-3).map((r, i) => h_flex().id(`pf-fail-${i}`).h(22).gap(6).items_center()
    .tooltip([`${r.name || r.tool} (${kindWord(r.tool)}) · failed at ${clock(startOf(r))}`, r.args ? `Arguments: ${r.args}` : "", r.result ? `Result: ${r.result}` : ""].filter(Boolean).join("\n"))
    .child(div().flex_none().text_size(11).text_color(t.ansi1).child("✕"))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${r.name || r.tool} · ${kindWord(r.tool)}`))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(took(r.duration_ms || 0)))))
    .when(e.length > 3, (x) => x.child(div().text_size(11).text_color(t.dim).child(`and ${e.length - 3} more`)))];
}

// Session's Profile section: the summary, the last rows of the tree (skills, agents, compactions) and
// the last failures. The full tree and the sequence diagram: the Profile popup.
export function sectionRows(t, P, max = 10) {
  const e = P.empty();
  if (e) return [div().mx(14).pb(2).text_size(12).text_color(P.error ? t.ansi1 : t.dim).child(e)];
  const m = P.model();
  const rows = flatten(m, false);
  const longest = Math.max(0, ...rows.map(([n]) => (n.record && !n.record.running && n.record.duration_ms) || 0));
  const first = Math.max(0, rows.length - max);
  const out = [div().mx(14).pb(6).text_size(12).text_color(t.muted).child(summary(m.stats))];
  if (first) out.push(div().mx(14).pb(2).text_size(11).text_color(t.dim).child(`… ${first} more ${first === 1 ? "row" : "rows"} above, in Details`));
  rows.slice(first).forEach(([n, depth], i) => {
    const d = describe(m, n), r = n.record;
    out.push(h_flex().id(`pf-${first + i}`).h(24).flex_none().mx(6).px(8).gap(6).items_center().rounded(7)
      .hover((s) => s.bg(t.hover)).tooltip(d.info)
      .child(div().w(Math.min(depth, 6) * 12).flex_none())
      .child(bullet(t, m, n, d))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5)
        .text_color(r?.ok === false ? t.ansi1 : n.marker ? t.dim : t.foreground).child(d.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(d.inline ? "inline" : d.kind))
      .child(div().w(50).flex_none().text_right().text_size(12).text_color(t.muted)
        .child(r ? (r.running ? "running" : took(r.duration_ms || 0)) : ""))
      .child(r ? bar(t, hueOf(m, d.ctx), r.running ? 0 : share(r.duration_ms || 0, longest), 36) : div().w(36).flex_none()));
  });
  out.push(...failureRows(t, m));
  return out;
}

// The one-line collapsed form: the summary, or why there is nothing.
export function sectionLine(t, P) {
  const e = P.empty();
  if (e) return div().mx(14).pb(2).text_size(12).text_color(P.error ? t.ansi1 : t.dim).child(e);
  const st = P.model().stats;
  return h_flex().mx(14).pb(2).gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(summary(st)))
    .when(st.failures.length > 0, (x) => x.child(div().flex_none().text_size(11.5).text_color(t.ansi1)
      .child(`✕ ${st.failures.length} failed`)));
}

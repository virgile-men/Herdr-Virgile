// Slash commands for the "/" list above the message box. Whatever the person types goes to
// the agent as typed; this only suggests. A command that opens a menu in the CLI (no
// arguments given) needs the terminal, so the chat switches to it after sending.
// Local patch (slash-sync): Claude Code's own list (its commands_changed message), as its terminal shows.

import { exec } from "herdr";

// The lists and the scan are core/slash.js, shared with the web app.
import { SCAN, scanned, commandList } from "./core/slash.js";
export { opensMenu, typing, match } from "./core/slash.js";

// Claude Code's commands and skills, from the CLI itself, in the agent's folder: one JSON line.
const LIST = String.raw`
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || [ ! -r "$HOME/.config/claude/oauth-token" ] || export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.config/claude/oauth-token")"
cd "$1" 2>/dev/null || cd
claude -p /cost --output-format stream-json --verbose --no-session-persistence </dev/null 2>/dev/null | grep -E '"subtype":"(init|commands_changed)"'
true`;

const short = (s) => {
  const t = String(s ?? "").replace(/\s*\((user|project|plugin[^)]*|bundled|dynamic workflow|built-in)\)\s*$/i, "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t;
};

// Names from the CLI's init message (slash_commands: always there), descriptions from its
// commands_changed message when it sends one, else from the folders' scan and the built-in list.
async function fromCli(machine, cwd) {
  const r = await exec("sh", ["-c", LIST, "list", cwd ?? ""], { on: machine, timeout: 45000 });
  let init = null, changed = null;
  for (const l of String(r.stdout ?? "").split("\n")) {
    try { const j = JSON.parse(l); if (j?.subtype === "init") init = j; else if (j?.subtype === "commands_changed") changed = j; } catch {}
  }
  const keep = (n) => n && !String(n).startsWith("__");
  if (Array.isArray(changed?.commands) && changed.commands.length)
    return changed.commands.filter((c) => keep(c?.name)).map((c) => ({ name: String(c.name), about: short(c.description) || "Command" }));
  const names = (init?.slash_commands ?? []).filter(keep).map(String);
  if (!names.length) return [];
  const known = new Map(commandList("claude").map((c) => [c.name, c.about]));
  const s = await exec("sh", ["-c", SCAN, "scan", cwd ?? ""], { on: machine }).catch(() => null);
  for (const c of scanned(s?.stdout)) known.set(c.name, c.about);
  return names.map((n) => ({ name: n, about: known.get(n) ?? (init.skills?.includes(n) ? "Skill" : "Command") }));
}

const cache = new Map(); // key -> { at, list: Promise<[{ name, about }]> }
const FRESH = 120000;
// Every command this agent knows: [{ name, about }], built-in first. Kept 2 min per machine and folder.
export async function commands(kind, machine, cwd) {
  if (kind !== "claude") return commandList(kind);
  const k = `${machine ?? ""}|${cwd ?? ""}`;
  const c = cache.get(k);
  if (!c || Date.now() - c.at > FRESH) {
    const old = c?.list;
    const list = fromCli(machine, cwd)
      .then((l) => (l.length ? l : Promise.reject(new Error("empty"))))
      .catch(() => exec("sh", ["-c", SCAN, "scan", cwd ?? ""], { on: machine }).then((r) => scanned(r.stdout)).catch(() => old ?? []));
    cache.set(k, { at: Date.now(), list });
  }
  const mine = await cache.get(k).list;
  // The CLI's list first (what its terminal offers), then this list's own built-ins it left out
  // (those only an interactive session has: /resume, /permissions…).
  const seen = new Set(mine.map((c) => c.name));
  return [...mine, ...commandList(kind).filter((c) => !seen.has(c.name))];
}

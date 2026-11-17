# Herdr-Virgile

A herdr-app layout built from `main` 0.1.12, with an English UI (code comments and internal ids such as `contexte` and `alertes` are French). The left sidebar keeps Spaces and Agents. Spaces gains nested groups, per-space icons and colors, and per-terminal labels. Agents is pinned to the bottom of the sidebar, with groups, a kanban view and a "Rangés" (settled) section. The tab bar gets four buttons, **Files · Vault · Session · Alertes**, each opening its panel on the right. Agent panes get a **Trace | Terminal** switch that swaps the terminal for a chat-style view of the agent's session. The panels follow the Claude Code session of the active terminal: environment, CPU, memory and network use, context window, prompt cache, background jobs, sub-agents, held commands and notifications, plus a **Profile** of the session's skill and agent calls (from the harness-profiler plugin) with a native sequence diagram.

## What you see

Left to right: a 301px sidebar, then the work column.

- **Sidebar** (`chrome` background, fixed width 301px, min 44, max 480; not resizable):
  - **Brand**, 46px, shipped `workspace-chrome`, draggable window area.
  - **Spaces** (`spaces-virgile`), fills the height (min 90px).
    - One flat list of spaces; the ☰ menu next to + can bring back one header per machine (off by default).
    - Under each space are its terminals: the first tab, or all of them once expanded. Each shows its machine as a pill, e.g. "lxc-perso · t6 · /root", or the laptop icon alone for this computer. Each can carry free labels (a name and a color), set by right-clicking the terminal.
    - Each tab line shows its own git branch (not main/master; ahead/behind always) after its name, which keeps priority up to 150px. A tab in Trace mode takes the folder of the agent parked behind its chat pane (`herdr.chat` label). Space rows show no branch.
    - A tab moves to another space on the same machine by dragging it onto that space, by right-click › "Move to a space…", or with `spaces-virgile.move-tab-next` / `move-tab-prev`. herdr-app has no command for it, so `deplacer.js` parks each terminal (`terminal.park`), waits until its `herdr.tab` label is gone, then labels it `herdr.space=<target> herdr.tab=tb<new id>` so herdr-app adopts it as a new tab, and renames that tab. A Trace tab's agent is relabeled the same way (and loses `herdr.chat=`); its old chat pane is closed only after adoption (lib/parked.js would end an agent with neither pane nor chat), then Trace is reopened like the pane-chat switch does, and `hc keep` restored. Labels follow the tab; the exact split layout does not.
    - Groups of spaces nest up to 8 levels deep. Each group has a name, a Lucide icon and a color, and sub-groups inherit the root group's color.
    - A root group sits at the top, between two ungrouped spaces, or below them: drop it on the top or bottom half of a space. `after: { gid: [spaceId…] }` keeps up to 8 fallback spaces, nearest first, so the group keeps its place when one closes. Herdr's space order never changes. With the per-machine headers on, groups stay at the top.
    - A space never leaves its machine. Dropping an ungrouped space on an ungrouped space of another machine opens "Group these two spaces". `spaces-virgile.group-homonyms` groups ungrouped spaces that share a name across machines.
    - Every space can have its own icon and color.
    - The + button asks which machine to open the new space on; each group has its own +.
  - **Agents** (`agents-virgile`) sits at the bottom of the sidebar, starting at 200px with a minimum of 42px.
    - Its height is computed from its rows: header 41, agent row 30, sub-agent 26, section 30, group 26, bottom padding 8. It is capped at half the height of Spaces plus Agents.
    - Groups of agents sit on top. The other agents follow the shipped sort, priority or grouped by space, with pinned agents first.
    - Below the scrolling list sits a **Settled** footer, folded by default. When open it shows at most 5 rows, newest first, each with the time since it was settled.
    - Clicking the "Agents" title folds the whole list to a 42px header that shows the total and the counts of agents waiting, working and done.
  - **Footer**, 69px, shipped `workspace-chrome` with `footer: true`.
- **Work column**:
  - **Tab bar** (`tabs-vault`), 42px, draggable. It shows the tabs as pills. At the right sit the panel buttons Files, Vault, Session (icon `contexte.svg`) and Alerts. The Alerts label becomes "Alerts · N" when commands are held or rules are pending, and "Alerts •" when notifications are unseen. Buttons are 26px high, 12px text, `selected` background when on.
  - **Body**: a row with padding 8 and gap 8.
    - **Main**: the active tab's panes, with a 10px radius, a 1px `border` (`accent` when focused), an 8px gap between panes, and `lone` set. Each pane has the `pane-chat` header (30px, always shown): program icon, agent name or terminal title, folder, status, split, zoom and close buttons. On a Claude Code or Codex pane it adds a segmented **Trace | Terminal** switch.
    - **Panel**: 324px (min 280, max 900), a stack of `files`, `vault`, `contexte` and `alertes`.
  - **Status bar**, 28px, shipped `workspace-status`.
- **Root**:
  - `canvas` background, 1px `border` dividers, terminal padding [14, 12];
  - `titlebar: "none"` with the traffic lights at [12, 16];
  - theme `paper` in light mode and `github-dark-high-contrast` in dark mode (included: background `#0a0c10`, foreground `#f0f3f6`, cursor `#71b7ff`).

## How it behaves

- **Agent statuses**, everywhere in Agents:
  - **working**: a 12px spinner in the theme's `working` color, turning every 900 ms;
  - **blocked**: a "Needs you" pill, with text in the `blocked` color on that color at 15% opacity; in compact places, a 14px "!" square;
  - **done**: a 7px filled dot in the `done` color;
  - **idle**: a 7px ring with a 1.5px border.

  A done agent turns idle once its turn was seen (`herdr.seen` label ≥ `turn`). A folded group shows the most urgent status of its members.
- **Agents list**:
  - Click an agent: `pane.focus`, or `terminal.peek` for an agent without a pane.
  - Right-click: Open, Peek, Pin, "Settle its tab" / "Unsettle", Move to group, New group, Remove from group, and Kanban view.
  - Drag agents onto groups, into another order, or onto the Settled header.
  - Agents shown inside a Trace chat pane (a terminal labelled `herdr.chat=<pane>`, which the shipped `agents()` omits) are listed too.
  - An agent is forgotten 15 s after its terminal is gone, but only if its machine is reachable and lists at least one terminal.
- **Settled**:
  - "Settle its tab" runs `tab.settle` on the agent's tab, which settles the whole tab, on this screen only.
  - Showing the tab, an agent of it needing the user, `tab.unsettle`, or dragging its agent elsewhere brings it back.
  - Optional, from ☰ › "Auto-settle…": after 1, 3, 7 or 14 days with every agent and sub-agent idle, a tab is settled on its own. This never applies to the shown tab, a pinned or focused agent, or an unseen done agent. The default is never.
- **Kanban** (☰ › Kanban view): a 1400×860 dialog with the columns Idle, Needs you, Working and Done (Idle first, on the left), and filters by root group.
  - A card shows machine › space › tab, folder, branch and durations. For Claude Code it adds the title, model, effort, mode, context %, estimated cost, prompts and compactions, last prompt and last reply, savvy-progress step, sub-agents, and the agent's own CPU, RAM and network.
  - "Detailed / Compact" (or the C key) reduces each card to three lines, with the rest in its tooltip.
  - Session data refreshes every 20 s and resources every 5 s, only while the kanban is open.
- **Tab bar**:
  - Each Panel button toggles its panel, using `layout.select` on `panel-body` and `layout.show` / `layout.hide` on `panel`.
  - The open panel is remembered per space.
  - A tab that runs a Claude Code session is named after that session's title. A name given by hand is never changed.
  - The scroll wheel switches tabs.
  - When Blast Radius holds a command, the Alerts panel opens by itself.
- **Session** (`contexte`) shows, for the active terminal's Claude Code session:
  - environment;
  - Resources: the agent's process tree and its whole machine, every 3 s, folded to two lines by default (click the title);
  - the context window, from `claude -p /context`;
  - a cache summary, whose "Details" link opens **Cache** as a 560px dialog: cache state, keepwarm buttons and the cold-send guard;
  - background jobs;
  - sub-agents with model, tokens, cost and savvy-progress plan;
  - **Profile** (English UI, unlike the rest): the harness-profiler trace of the session, folded to a one-line summary by default (click the title). Its "Sequence" and "Details" links open **Profile** (`profile`) as an 1100px dialog with two views:
    - Tree: one row per skill or agent call (per tool call with "All calls"), with start, duration, a square-root duration bar and the tokens of the context it opened; a click unfolds arguments and result;
    - Sequence: the plugin's sequence diagram redrawn natively, one lifeline per context. Lines and arrowheads are `window.paint_path` paths (`PathBuilder`), bars and labels are absolutely positioned divs. Rows are events in time order; contexts that never overlap share a column; only the last 400 rows are drawn.
    - "Open in browser ↗" renders the plugin's own page on the agent's machine and opens it. Commands `profile.tree`, `profile.sequence`, `profile.all` and `profile.section` reach the shown popup.
- **Alerts** (`alertes`):
  - Blast Radius: commands held by the plugin, answered by pressing 1 or 2 in the agent's terminal;
  - Rules: reflect-mod rules to accept, written to CLAUDE.md after checking the file did not change;
  - Notifications: agents waiting or done.
- **Trace | Terminal**:
  - Trace splits a `chat` pane beside the agent's pane, then parks the agent's terminal (`terminal.park`: it keeps running without a pane) and labels it `herdr.chat=<chat pane>`, so the chat takes the exact slot. Terminal does the reverse. Each step runs through `herdr-app do`.
  - The Trace view reads the agent's own session log (Claude Code `~/.claude/projects/…/<session>.jsonl`, or Codex's rollout file). It shows replies as plain full-width text, tool calls grouped as rows with icons, background jobs, and a message box with the model and effort line. Messages are sent with `hc send`. It uses the system font (`.AppleSystemUIFont` on macOS).
  - `chat-models` is the model and effort popup. `chat-image` views pictures and attached files.
- **Vault** (also `cmd-shift-y`): environment variables per machine, stored in `~/.config/herdr-vault/env` (mode 0600) and loaded only in Herdr terminals.

## Built from

- **Layout**: `layouts/Herdr-Virgile.json`, cloned from `main` 0.1.12. The node tree is `root` (row) → `sidebar` (column: `brand`, `sidebar-lists` [`spaces`, `agents`], `sidebar-footer`) and `work` (column: `tabs`, `work-body` [`main`, `panel` → `panel-body` stack], `status`).
- **Shipped mods it uses**: `workspace-chrome`, `files`, `workspace-status`.
- **Its own mods** (folders in `mods/`):
  - `tabs-vault`, `spaces-virgile` and `agents-virgile` are copies of the shipped `tabs`, `spaces` and `agents` 0.1.12;
  - `vault`, `contexte`, `cache`, `profile` and `alertes` are new. `profile` ports hp.js's context model and view.html's sequence layout from harness-profiler 0.2.2 (MIT, `LICENSE-harness-profiler`).
  - `pane-chat`, `chat`, `chat-models` and `chat-image` are Shepherdr's (MIT), in the Trace look of the author's fork, without the rest of Shepherdr. Their `addons.js` keeps only `chat` and `needs` on, which switches off voice, reactions, artifacts, browser and autopilot. Tasks, secrets and the coordinator have no switch; they stay out of reach because their tools (`herdr-task`, `herdr-secret`, `restart.sh`) aren't there. The task state icons are copied into `chat/tasks-icons/` and the artifacts icon into each mod.
- **Shared state**:
  - `shared("spaces-virgile")` and `shared("agents-virgile")` hold the group trees (and, for Spaces, where root groups sit among spaces);
  - `spaces-virgile.movetab` relays a tab move chosen in an overlay to the sidebar copy, since a closed overlay loses its tasks;
  - `agents-virgile.replie`, `.kanban.compact`, `.ranges.ouvert` and `.ranges.auto` hold the Agents settings;
  - `spaces-virgile.height` is published so that Agents can cap its height;
  - `profile.collapsed`, `profile.view` and `profile.all` hold the Profile settings;
  - `space.colors`, `agents.sort` and `workspace.panels` are shared with the shipped mods.
- **herdr functions used**:
  - state: `agents()`, `terminals()`, `panes()`, `spaces()`, `focused()`, `shared` / `setShared`, `layout()`, `settings()`, `theme()`;
  - views and agent order: `openOverlay`, `setAgentOrder`;
  - commands: `nextCommand()`, and `run()` with `layout.resize`, `layout.select`, `layout.show`, `layout.hide`, `pane.focus`, `terminal.peek`, `terminal.pin`, `tab.settle`, `tab.unsettle`, `tab.rename`, `space.new`, `space.move`, `space.rename`, `agent.focus`, `mod.open`.
- **Programs it runs** on the agent's machine, through `exec` and `hc exec`:
  - `sh` and `awk`, which read `~/.claude/sessions/`, `~/.claude/projects/*/*.jsonl` (and each session's `subagents/`), `~/.claude/settings.json`, `~/.claude/plugins/store/`, `~/.claude/plugins/installed_plugins.json` and the harness-profiler traces in `<git root>/.harness-profile/`;
  - the plugin's `hp.sh tree <session> --format html` for "Open in browser", then `open` (`xdg-open` on Linux) on this machine;
  - `claude -p /context --resume <id> --no-session-persistence`. If `CLAUDE_CODE_OAUTH_TOKEN` is unset, it reads `~/.config/claude/oauth-token` for that command only;
  - `ps`, `nettop`, `netstat` and `vm_stat` on macOS; `/proc`, `ss` and `/sys/fs/cgroup` on Linux;
  - `hc send`, `hc read` and `hc keys` for `/keepwarm`, `/cache-tax` and Blast Radius answers.
  - Nothing reaches the network: Shepherdr's voice call (ElevenLabs) is in `chat` but switched off.
- **Claude Code plugins it reads** (optional; only the section that needs one stays empty without it):
  - savvy-progress: sub-agent plans;
  - cache-tax: keepwarm and the guard;
  - reflect-mod: Rules;
  - blast-radius: held commands. Its marketplace is in `claude-plugins/playground-mods`;
  - harness-profiler (`afurmanov/harness-profiler`, needs Node 18+ on the machine): the Profile section and popup. A session started before it was installed records nothing until `/reload-plugins`.
- **Art**:
  - Lucide 0.460 icons (ISC, `icons/LICENSE-lucide`).
  - `mods/contexte/core/` is Shepherdr's log reader (MIT, `core/LICENSE-shepherdr`).

## Watch out

- **`herdr-app check` writes to the real home.** It runs the mod and saves its `setShared` writes into the `shared.json` of `HERDR_APP_HOME`. Run with no spaces, Spaces empties `space.colors`. Check copies with `HERDR_APP_HOME` set to an empty folder whose path is short, since the socket path must fit `SUN_LEN`.
- **A second herdr-app home shares the same herdr-core.** It shows the same spaces and machines, so it is not a clean demo window.
- **Agents sets its own height.** It runs `layout.resize {id: "agents", px}` from a 250 ms timer, never from `render`. The block's `min` must be 42, or the folded list cannot shrink. `sidebar-lists` is `resizable: false`.
- **`${…}` is interpolated inside `String.raw`.** Shell scripts in template strings cannot use `${var%%…}`.
- **`line_height(16)` is read in rem.** Write `"16px"`.
- **`writeTextFile` will not overwrite** unless it is given the expected old content as its third argument.
- **A throw inside the `nextCommand` loop kills it.** Keep the loop in try/catch.
- **The copied shipped mods track 0.1.12.** On a newer herdr-app they don't follow upstream changes.
- **Settling is per screen.** It is kept in `view.json` and is not shared between windows.
- **Dates are formatted by hand.** The mod runtime ignores the locale and options of `toLocaleString` and its siblings (it always prints `11/16/2026, 02:56:15 AM`), so mods write `16 Nov, 02:56` themselves.
- **Notification titles are rebuilt from their type.** Old entries of `shared("alertes.notifications")` stored French titles; the panel renders the title from `type` and the agent's name (`titreNotif` in `notifs.js`).
- **Price tables are copied** into `claude.js` and `agents-virgile/session.js`. Update both when prices change.
- **Trace needs `sh` on the agent's machine.** On Windows, an agent started in PowerShell or cmd gets an empty Trace. Agents in WSL (as a machine) or on Linux and macOS work.
- **Without Shepherdr's hook**, permission prompts are answered in the terminal. Restarting an agent with another model needs Shepherdr's coordinator, so it fails here with a message.
- **The installer leaves Trace alone where Shepherdr is installed** (`lib/addons.json`): Shepherdr's copies are complete, while these are trimmed.
- **Tested on macOS only.** The Linux branches of the resource scripts were exercised on remote Proxmox and LXC machines, not as the local machine.

## Done when

- `HERDR_APP_HOME=<empty dir> herdr-app check mods/<mod>` passes for `tabs-vault`, `vault`, `contexte`, `alertes`, `cache`, `profile`, `spaces-virgile` and `agents-virgile`.
- `herdr-app do layout.switch '{"name":"Herdr-Virgile"}'` shows the layout: Spaces on top, Agents at the bottom, and the four panel buttons in the tab bar.
- Clicking "Agents" folds the list to 42px with the per-status counts, and clicking again restores it.
- `herdr-app do tab.settle --id <tab>` moves that tab's agents into Settled, and `tab.unsettle` brings them back to their group.
- `herdr-app do agents-virgile.kanban` opens the kanban with one card per agent. Pressing C toggles compact cards.
- With a Claude Code session in the active tab, Session shows its model, its context window and its resources, and the tab takes the session's title.
- With harness-profiler installed and a session that ran a skill or a subagent, Session › Profile shows its summary, and `herdr-app do mod.open '{"name":"profile"}'` then `herdr-app do profile.sequence` draws the sequence diagram.
- On a Claude Code pane, clicking Trace swaps the terminal for the conversation in the same slot, and Terminal brings the terminal back.
- `python3 installer.py --essai` lists the files it would copy and the `cmd-shift-y` key it would add, and writes nothing.

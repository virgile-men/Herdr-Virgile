# Herdr-Virgile

A layout for herdr-app, built from `main` (0.1.12). It keeps the sidebar (spaces and agents), the tabs and the status bar. The tab bar also gets the buttons **Files · Vault · Session · Alerts**, each opening its panel on the right. **Cache** opens as a popup from Session. The panels follow the Claude Code session of the active terminal. The whole UI is in English.

It needs neither Shepherdr nor anything but herdr-app. Some sections need Claude Code plugins: see below.

## Contents

| Path | Role |
|---|---|
| `layouts/Herdr-Virgile.json` | The layout. Theme `paper` in light mode, `github-dark-high-contrast` in dark mode. The original sizes are kept: sidebar, right panel and its tab (Session). |
| `mods/tabs-vault/` | The tab bar: a copy of the `tabs` mod shipped with herdr-app 0.1.12. It adds the Vault, Session and Alerts buttons, and names each tab after the Claude Code session it holds. It also watches Blast Radius and notifications. |
| `mods/vault/` | **Vault**: environment variables for Herdr terminals, per machine. It also opens with `cmd-shift-y`. |
| `mods/contexte/` | **Session**: the Claude Code session of the active terminal. Sections: environment; resources (CPU, memory and network of the agent and what it started, then of its whole machine, every 3 s; folded to two lines by default, a click on the title unfolds it, like Context; `ps`/`nettop`/`netstat` on macOS, `/proc`/`ss`/cgroup on Linux); the context window; a cache summary; background tasks; sub-agents; and **Profile**: the summary of the harness-profiler trace, collapsible like Context, with "Sequence" and "Details" links. |
| `mods/cache/` | **Cache**: the popup that "Details" opens in Session. It shows the prompt cache's state, with keepwarm and the guard. |
| `mods/profile/` | **Profile**: the popup that "Sequence" and "Details" open in Session. It shows the harness-profiler trace of the followed session: which skills and agents ran, in which context (inline or a new context), for how long, with which tokens, the failures and the compactions. Two views: **Tree** (the call tree; "All calls" adds tool calls) and **Sequence** (the plugin's sequence diagram, redrawn natively in herdr-app). "Open in browser ↗" opens the plugin's own page. Commands: `profile.tree`, `profile.sequence`, `profile.all`, `profile.section`. The context model and the diagram layout are ported from harness-profiler 0.2.2 (MIT license, © 2026 Aleksandr Furmanov), see `LICENSE-harness-profiler`. |
| `mods/alertes/` | **Alerts**: Blast Radius (held commands), Rules (suggested by reflect-mod) and Notifications (an agent waiting for an answer or done). |
| `mods/spaces-virgile/` | **Spaces**: a copy of the `spaces` mod shipped with herdr-app 0.1.12. Spaces form a single list (the ☰ menu next to + brings back one header per machine). Under each space it shows its terminals (tabs: the first one, all of them once expanded), each with its machine as a pill ("lxc-perso · t6 · /root"; on this computer, the icon alone: "· t1k · /Users/…") and its free labels (name, color; right-click the terminal). Each tab's git branch shows after its name (not `main` or `master`; ahead/behind always), instead of one per space. A tab **moves to another space on the same machine**: drag it onto that space, or right-click › "Move to a space…" (also `spaces-virgile.move-tab-next` / `move-tab-prev`). herdr-app has no command for this: the mod takes each terminal's pane away (`terminal.park`) and labels it for the target space (`hc label herdr.space=… herdr.tab=…`), which adopts it as a new tab; the name, labels, sub-agents and Trace mode follow, the exact split layout does not. It also adds groups of spaces nested up to 8 levels (name, icon, color inherited by subgroups, drag and drop, right-click), placed at the top, between two spaces or below them (drag the group onto the top or bottom half of a space). A space never leaves its machine, but dropping a space onto a space of another machine offers to group them (`spaces-virgile.group-homonyms` groups at once the same-named spaces of several machines). Then a + that asks which machine to open the new space on (also on each group), and an icon and a color of your choice for each space. Icons: Lucide (ISC license, `icons/LICENSE-lucide`). |
| `mods/agents-virgile/` | **Agents**: a copy of the `agents` mod shipped with herdr-app 0.1.12, pinned to the bottom of the sidebar (it takes the height of its list, at most half the column). It also shows agents opened in a chat pane (Trace), which the shipped list ignores. It adds groups of agents nested up to 8 levels (name, icon, color inherited by subgroups, drag and drop, right-click), the shipped sort (priority or by space) for ungrouped agents, a ☰ menu and a kanban view. A click on "Agents" collapses the whole list: only the header stays, with the number of agents that need you, are working or are done. A **Settled** section, pinned at the bottom and folded by default, holds the agents whose tab is settled (herdr-app's `tab.settle`: the tab is put away on this screen and keeps running). Settle a tab by right-click ("Settle its tab") or by dropping an agent on the Settled header. A tab leaves Settled when shown, when one of its agents needs you, by right-click, or by dragging its agent elsewhere. Optionally (☰ menu › Auto-settle), a tab whose agents have been idle for 1, 3, 7 or 14 days is settled by itself. The kanban has one column per state, Idle first (Idle, Needs you, Working, Done). Each card details the session: machine, space, tab, folder, branch, durations, and for Claude Code the title, model, effort, mode, context used, estimated cost, number of prompts and compactions, last prompt and last reply, progress and sub-agents, plus the CPU, memory and network it uses. A compact mode (Detailed / Compact button, or the C key) cuts each card to three lines and puts the rest in the tooltip. The kanban reads the session logs on each machine (`sh`, `awk`), only while it is open. Icons: Lucide (ISC license). |
| `mods/pane-chat/`, `mods/chat/`, `mods/chat-models/`, `mods/chat-image/` | **Trace**: the pane header with the **Trace \| Terminal** switch on agent panes (Claude Code, Codex), and the Trace view it opens in place of the terminal: the conversation read from the agent's session log, a message box, the model and effort, images and attachments. These four mods come from Shepherdr (MIT license, © 2026 Elias Stravik, `LICENSE-shepherdr` in each), in their Trace version, without the rest of Shepherdr. Its other features are not there: voice and dictation, reactions, artifacts, the browser and autopilot are switched off in this copy, and tasks, secrets and the coordinator have nothing to run on without Shepherdr. |
| `themes/github-dark-high-contrast.json` | The dark theme. |
| `keys.json` | The Vault shortcut, to merge. |
| `claude-plugins/playground-mods/` | The marketplace to install the blast-radius plugin from. |
| `installer.py` | Installs or updates all of the above into a herdr-app instance, state included (see below). |
| `etat/` | **In the zip only, not in the GitHub repository.** The original instance's state: Spaces labels, groups, icons and colors; Agents groups and settings (sort, collapsed list, compact kanban, Settled open, auto-settle); Session settings (folded sections, Profile); and what Spaces and the tab bar keep for each space (expanded, open panel). |
| `RECIPE.md` | The layout's card for the herdr.dev/layouts gallery: what you see, how it behaves, what it is made of, the pitfalls and the checks. An agent can rebuild it from there. |
| `paquet.json` | What the package holds, its date and the herdr-app version that produced it. |

## Install

From the GitHub repository, in a terminal (preferably a herdr-app terminal):

```sh
git clone https://github.com/virgile-men/Herdr-Virgile.git
python3 Herdr-Virgile/installer.py --dry-run   # shows what would be done, writes nothing
python3 Herdr-Virgile/installer.py             # installs or updates
```

The repository has no state (`etat/`): step 3 below is then skipped and you start from the default settings. The zip made by `export-herdr-virgile.py` on the original instance contains that state: unzip it, then run the same `installer.py` commands.

The script:

1. Copies `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/` (or `$HERDR_APP_HOME`, or `--home DIR`). If a file or mod already exists and differs, it first backs it up to `~/herdr-virgile-sauvegardes/<date>/`, then replaces it. Files that herdr-app writes into a mod itself (`*.d.ts`, `jsconfig.json`) stay. Where Shepherdr is installed (`lib/addons.json`), the Trace mods already there are left alone: Shepherdr's are complete.
2. Adds the Vault shortcut (`cmd-shift-y`) to `keys.json`, unless that key is already taken.
3. Writes the state (`etat/`), if there is one (the zip only). herdr-app rewrites these files while it runs, so the script asks you to quit it (⌘Q) and waits: terminals and agents keep running. It writes the state, then reopens herdr-app on macOS. Space colors are added to the instance's own; other keys replace its own, after a backup.
4. Checks every mod with `herdr-app check` (in a throwaway home, so the state is not touched) and switches to the layout.

Options: `--no-state` (layout, mods, theme and shortcut only), `--state-only` (for example after a Ctrl-C at step 3), `--no-relaunch`. The French names `--essai`, `--sans-etat`, `--etat-seulement` and `--pas-de-relance` still work. It needs Python 3 (on macOS: `xcode-select --install`). The script does not install the Claude Code plugins (see below).

**Updating**: `git -C Herdr-Virgile pull`, then run `installer.py` again. With the zip: export again on the original machine (`python3 export-herdr-virgile.py`, a script that is not in this package), copy the zip over and run `installer.py` again. Only what changed is replaced, with a backup.

**What the state does not carry over**:
- **The original computer's spaces.** They don't exist on another computer: their labels, groups and colors don't apply.
- **Remote machines' spaces.** Their state only applies if the other instance gives those machines the same names (Settings › Machines).
- **What stays on the original instance**: the durations shown by Agents, the notification and alert history, automatic tab names, and settled tabs (herdr-app keeps them per screen).
- **Vault variables.** They stay on each machine.

An agent in herdr-app can also install it without the script: give it this folder and ask it to follow "Layouts and mods other people made" in `~/.config/herdr-app/AGENTS.md`. By hand:

1. Copy `layouts/`, `mods/` and `themes/` into `~/.config/herdr-app/`, **overwriting nothing**. If a name is already taken, rename the new copy, along with the `mod` names in the layout and the mod's `mods/<name>/` paths.
2. Add the line `"cmd-shift-y": "mod.open:vault"` to `~/.config/herdr-app/keys.json`, section `global`. If that key is taken, pick another.
3. Run `herdr-app check ~/.config/herdr-app/mods/<mod>` for `tabs-vault`, `vault`, `contexte`, `cache`, `profile`, `alertes`, `spaces-virgile` and `agents-virgile`. If herdr-app is closed, set `HERDR_APP_HOME` to an empty folder for these checks: otherwise `check` keeps in `shared.json` what the mod stores there with no spaces (Spaces then erases the colors).
4. The state (`etat/`) can't be applied by hand: use `installer.py --state-only`.
5. Switch to the layout with `herdr-app do layout.switch '{"name":"Herdr-Virgile"}'`, from the palette ("Layout: Herdr-Virgile"), or with `ctrl-shift-l`. Go back to yours the same way. To remove everything, delete the copied files.

## Claude Code plugins

The plugins **are not in this folder**. The panels only read what the plugins write (the session log, their store) and send them slash commands. So install each plugin **on every machine where Claude Code runs**. Without a plugin, only the section that needs it stays empty or greyed out; the rest works.

| Section | Plugin | Without the plugin |
|---|---|---|
| Session › Sub-agents: plan, phase, progress | savvy-progress 1.2.1 | Sub-agents are still listed, without plan or progress. |
| Session › Cache and the Cache popup: keepwarm buttons (90 min, 6 h, Stop) and the guard | cache-tax 2.2.1 (it provides `/keepwarm` and `/cache-tax`) | The buttons are greyed out. The cache state is still computed from the log. |
| Alerts › Rules | reflect-mod 3.3.0 | The section says the plugin is not active and suggests no rule. "Add a rule" still works. |
| Alerts › Blast Radius | blast-radius 0.1.0 | No command is held. |
| Session › Profile and the Profile popup | harness-profiler 0.2.2 (it needs Node 18 or later on the machine) | The section says the plugin is not installed on that machine. A session opened before the install records nothing until you run `/reload-plugins` in it. |
| Vault, Alerts › Notifications, the rest of Session | none | — |

```sh
claude plugin marketplace add johnnyvizz/claude-kit
claude plugin install savvy-progress@claude-kit

claude plugin marketplace add karanb192/claude-code-mods
claude plugin install cache-tax@claude-code-mods

claude plugin marketplace add bayramannakov/claude-reflect
claude plugin install reflect-mod@claude-reflect-marketplace

# blast-radius: first copy claude-plugins/playground-mods somewhere durable,
# because Claude Code keeps the folder's path.
mkdir -p ~/.claude/marketplaces && cp -R claude-plugins/playground-mods ~/.claude/marketplaces/
claude plugin marketplace add ~/.claude/marketplaces/playground-mods
claude plugin install blast-radius@playground-mods

claude plugin marketplace add afurmanov/harness-profiler
claude plugin install harness-profiler@harness-profiler
```

## Before you install

These mods run programs and read files outside their folder. They send nothing over the network: the code for Shepherdr's voice call (ElevenLabs) is in `chat`, but switched off.

- They run `sh` and `awk` through `exec` and `hc exec`, on the followed agent's machine. There they read `~/.claude/sessions/`, `~/.claude/projects/*/*.jsonl`, `~/.claude/settings.json` and `~/.claude/plugins/store/`.
- **Session** runs `claude -p /context --resume <session> --no-session-persistence` in the agent's folder. It is a local Claude Code command: it doesn't call the model and writes nothing to the session. It assumes `claude` is on the PATH. If `CLAUDE_CODE_OAUTH_TOKEN` is not set and `~/.config/claude/oauth-token` exists, the script reads that file and passes its token to that one command, on the agent's machine. The `/compact` button sends the command to the session with `hc send`.
- **Cache** sends `/keepwarm …` and `/cache-tax guard …` to the session with `hc send`.
- **Profile** reads, on the agent's machine, the trace that harness-profiler writes to `<git root of the launch folder>/.harness-profile/<session>.jsonl` (the plugin adds that folder to `.git/info/exclude`; outside a git repository it is in the launch folder), and the sub-agents' transcripts (`~/.claude/projects/*/<session>/subagents/`). "Open in browser ↗" runs `hp.sh tree <session> --format html` on that machine (through `hc exec` when it is remote), writes the page to `$TMPDIR` and opens it with `open` (`xdg-open` on Linux).
- **Alerts › Blast Radius** reads the agent's screen with `hc read` and answers the plugin with `hc keys`: `1` to run, `2` to cancel. **Rules** writes to `~/.claude/CLAUDE.md` (or the project's CLAUDE.md) and to reflect-mod's store. Before writing, it checks that the file hasn't changed since it was read.
- **Vault** keeps the variables in `~/.config/herdr-vault/env` (mode 0600) on each machine. It adds, once, a line to `~/.bashrc` / `~/.zshrc` that loads this file, only in Herdr terminals (`HC_TERMINAL_ID`).
- **Trace | Terminal**: switching to Trace opens a `chat` pane beside the agent's, then parks the agent's terminal without a pane (it keeps running) and labels it `herdr.chat=<pane>`. Terminal does the reverse. These swaps go through `herdr-app do` (`pane.split`, `terminal.park`…), which must therefore be on the PATH. The view reads the agent's log with `sh` on its machine, like Session. It sends messages with `hc send`, keeps drafts and attachments in `data/chat-*` of herdr-app's home, and `chat-image` copies an image or opens a file with the system's tools (`osascript`/`open`, `powershell`/`explorer`, `xclip`/`xdg-open`).
- The tab bar renames tabs after the Claude Code session running in them. A name you chose yourself is never touched.

## Limits

- Built and used on herdr-app 0.1.12, on macOS. `tabs-vault`, `spaces-virgile` and `agents-virgile` are copies of that version's `tabs`, `spaces` and `agents`. On a newer version, they don't follow the shipped mods' changes.
- **Trace and Windows**: Trace reads the session log with `sh`. It works for an agent in WSL added as a machine, or on a Linux or macOS machine. For an agent started directly in Windows (PowerShell, cmd), the view stays empty: switch to Terminal. Session's and the kanban's measurements have the same limit.
- **Trace without Shepherdr**: Claude Code's permission prompts go through a Shepherdr hook that this package doesn't install; without it, you answer them in the Terminal. Changing the model or effort from Trace restarts the agent with Shepherdr's coordinator script, which is missing here: that change fails with a message. Tasks, artifacts, voice, dictation and reactions don't show.
- **Popup corners**: herdr-app draws each popup's rounded frame but doesn't clip its content, so the mods round their own background to 5 px. Some of herdr-app's own screens (Settings, the keys help, Keybinds, Add a machine) still show square corners.
- `sbx` sandboxes (a personal tool) are removed from Session › Sub-agents.
- The code comments and internal names (mod ids such as `contexte` and `alertes`, the `etat/` folder) are in French.
- `mods/contexte/core/` is Shepherdr's log reader (MIT license, © 2026 Elias Stravik), see `core/LICENSE-shepherdr`.

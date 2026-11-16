# Herdr-Virgile

Un layout pour herdr-app, basé sur `main` (0.1.12). Il garde la barre latérale (espaces et agents), les onglets et la barre d'état. L'en-tête des onglets porte en plus les boutons **Files · Vault · Session · Alertes**. Ils ouvrent chacun leur panneau à droite. **Cache** s'ouvre en popup depuis Session. Les panneaux sont en français et suivent la session Claude Code du terminal actif.

Il ne demande ni Shepherdr ni rien d'autre que herdr-app. Certaines sections ont besoin de plugins Claude Code : voir plus bas.

## Contenu

| Chemin | Rôle |
|---|---|
| `layouts/Herdr-Virgile.json` | Le layout. Thème `paper` en clair, `github-dark-high-contrast` en sombre. Les tailles d'origine y sont reprises : barre latérale, panneau de droite et son onglet (Session). |
| `mods/tabs-vault/` | L'en-tête des onglets : une copie du mod `tabs` livré avec herdr-app 0.1.12. Il ajoute les boutons Vault, Session et Alertes, et nomme chaque onglet d'après la session Claude Code qu'il contient. Il surveille aussi Blast Radius et les notifications. |
| `mods/vault/` | **Vault** : des variables d'environnement pour les terminaux Herdr, par machine. Il s'ouvre aussi avec `cmd-shift-y`. |
| `mods/contexte/` | **Session** : la session Claude Code du terminal actif. Sections : environnement, ressources (processeur, mémoire et réseau de l’agent et de ce qu’il a lancé, puis de sa machine entière, toutes les 3 s ; réduite à deux lignes par défaut, un clic sur le titre la déplie, comme Contexte ; `ps`/`nettop`/`netstat` sous macOS, `/proc`/`ss`/cgroup sous Linux), fenêtre de contexte, résumé du cache, tâches en arrière-plan et sous-agents. |
| `mods/cache/` | **Cache** : le popup qu'ouvre « Détails » dans Session. Il donne l'état du cache de prompt, avec keepwarm et la garde. |
| `mods/alertes/` | **Alertes** : Blast Radius (les commandes retenues), Règles (proposées par reflect-mod) et Notifications (agent qui attend une réponse ou qui a fini). |
| `mods/spaces-virgile/` | **Spaces** : une copie du mod `spaces` livré avec herdr-app 0.1.12. Les spaces forment une seule liste (le menu ☰ à côté du + remet un en-tête par machine). Sous chaque space, elle montre ses terminaux (onglets : le premier, tous une fois déplié), chacun avec sa machine en pastille (« lxc-perso · t6 · /root » ; sur cet ordinateur, l’icône seule : « · t1k · /Users/… ») et ses étiquettes libres (nom, couleur ; clic droit sur le terminal). Elle ajoute aussi des groupes de spaces imbricables sur 8 niveaux (nom, icône, couleur héritée par les sous-groupes, glisser-déposer, clic droit) un + qui demande sur quelle machine ouvrir le nouveau space (aussi sur chaque groupe) et une icône et une couleur au choix pour chaque space. Icônes : Lucide (licence ISC, `icons/LICENSE-lucide`). |
| `mods/agents-virgile/` | **Agents** : une copie du mod `agents` livré avec herdr-app 0.1.12, collée en bas de la barre (elle prend la hauteur de sa liste, au plus la moitié de la colonne). Elle montre aussi les agents ouverts dans un volet de chat (Trace), que la liste livrée ignore. Elle ajoute des groupes d’agents imbricables sur 8 niveaux (nom, icône, couleur héritée par les sous-groupes, glisser-déposer, clic droit), le tri livré (priorité ou par space) pour les agents hors groupe, un menu ☰ et une vue kanban (une colonne par état). Un clic sur « Agents » replie toute la liste : seul l’en-tête reste, avec le nombre d’agents qui vous attendent, en cours ou terminés. Une section **Rangés**, collée en bas et repliée par défaut, reçoit les agents dont l’onglet est rangé (`tab.settle` de herdr-app : l’onglet est mis de côté sur cet écran et tourne toujours). On range un onglet au clic droit (« Ranger son onglet ») ou en lâchant un agent sur l’en-tête Rangés. Un onglet sort des rangés quand on l’affiche, quand un de ses agents vous attend, au clic droit ou en glissant son agent ailleurs. En option (menu ☰ › Ranger automatiquement), un onglet dont les agents sont au repos depuis 1, 3, 7 ou 14 jours est rangé tout seul. Chaque carte du kanban détaille la session : machine, space, onglet, dossier, branche, durées, et pour Claude Code le titre, le modèle, l’effort, le mode, le contexte utilisé, le coût estimé, le nombre de demandes et de compactages, la dernière demande et la dernière réponse, la progression et les sous-agents, ainsi que le processeur, la mémoire et le réseau qu’il consomme ; une bande en haut donne ceux de chaque machine entière (toutes les 5 s). Un mode compact (bouton Détaillé / Compact ou touche C) réduit chaque carte à trois lignes et met le reste dans l’infobulle. Le kanban lit les journaux de session sur chaque machine (`sh`, `awk`), seulement quand il est ouvert. Icônes : Lucide (licence ISC). |
| `themes/github-dark-high-contrast.json` | Le thème sombre. |
| `keys.json` | Le raccourci du Vault, à fusionner. |
| `claude-plugins/playground-mods/` | Le marketplace qui permet d'installer le plugin blast-radius. |
| `installer.py` | Installe ou met à jour tout ce qui précède dans une instance de herdr-app, état compris (voir plus bas). |
| `etat/` | **Dans le zip seulement, pas dans le dépôt GitHub.** L'état de l'instance d'origine : étiquettes, groupes, icônes et couleurs des Spaces, groupes et réglages d'Agents (tri, liste repliée, kanban compact, Rangés ouverts, rangement automatique), réglages de Session (sections réduites), et ce que Spaces et l'en-tête des onglets gardent pour chaque space (déplié, panneau ouvert). |
| `RECIPE.md` | La fiche du layout pour la galerie herdr.dev/layouts (en anglais) : ce qu'on voit, comment il se comporte, de quoi il est fait, les pièges et les vérifications. Un agent peut le reconstruire à partir d'elle. |
| `paquet.json` | Ce que contient le paquet, sa date et la version de herdr-app qui l'a produit. |

## Installer

Depuis le dépôt GitHub, dans un terminal (de préférence un terminal de herdr-app) :

```sh
git clone https://github.com/virgile-men/Herdr-Virgile.git
python3 Herdr-Virgile/installer.py --essai   # montre ce qui serait fait, sans rien écrire
python3 Herdr-Virgile/installer.py           # installe ou met à jour
```

Le dépôt ne contient pas d'état (`etat/`) : l'étape 3 ci-dessous est alors sautée et l'on part des réglages par défaut. Le zip produit par `export-herdr-virgile.py` sur l'instance d'origine contient cet état : le décompresser, puis lancer les mêmes commandes `installer.py`.

Le script :

1. Copie `layouts/`, `mods/` et `themes/` dans `~/.config/herdr-app/` (ou `$HERDR_APP_HOME`, ou `--home DIR`). Si un fichier ou un mod existe déjà et diffère, il le sauvegarde d'abord dans `~/herdr-virgile-sauvegardes/<date>/`, puis le remplace. Les fichiers que herdr-app écrit lui-même dans un mod (`*.d.ts`, `jsconfig.json`) restent.
2. Ajoute à `keys.json` le raccourci du Vault (`cmd-shift-y`), sauf si la touche sert déjà.
3. Écrit l'état (`etat/`), s'il y en a un (le zip seulement). herdr-app récrit ces fichiers tant qu'il tourne. Le script demande donc de le quitter (⌘Q) et attend : les terminaux et les agents continuent de tourner. Il écrit l'état, puis rouvre herdr-app sur macOS. Les couleurs des spaces s'ajoutent à celles de l'instance ; les autres clés remplacent les siennes, après sauvegarde.
4. Vérifie chaque mod avec `herdr-app check` (dans une maison jetable, pour ne pas toucher à l'état) et passe au layout.

Options : `--sans-etat` (layout, mods, thème et raccourci seulement), `--etat-seulement` (par exemple après un Ctrl-C à l'étape 3), `--pas-de-relance`. Il faut Python 3 (sur macOS : `xcode-select --install`). Le script n'installe pas les plugins Claude Code (voir plus bas).

**Mettre à jour** : `git -C Herdr-Virgile pull`, puis relancer `installer.py`. Avec le zip : réexporter sur la machine d'origine (`python3 export-herdr-virgile.py`, un script qui n'est pas dans ce paquet), recopier le zip et relancer `installer.py`. Seul ce qui a changé est remplacé, avec une sauvegarde.

**Ce que l'état ne fait pas suivre** :
- **Les spaces de l'ordinateur d'origine.** Ils n'existent pas sur un autre ordinateur : leurs étiquettes, groupes et couleurs ne s'appliquent pas.
- **Les spaces des machines distantes.** Leur état ne s'applique que si l'autre instance donne à ces machines le même nom (Settings › Machines).
- **Ce qui reste sur l'instance d'origine** : les durées affichées par Agents, l'historique des notifications et des alertes, les noms d'onglets automatiques, et les onglets rangés (herdr-app les garde par écran).
- **Les variables du Vault.** Elles restent sur chaque machine.

Un agent dans herdr-app peut aussi faire l'installation sans le script : lui donner ce dossier et lui demander de suivre « Layouts and mods other people made » dans `~/.config/herdr-app/AGENTS.md`. À la main :

1. Copier `layouts/`, `mods/` et `themes/` dans `~/.config/herdr-app/`, **sans rien écraser**. Si un nom existe déjà, renommer la nouvelle copie, et aussi les noms `mod` dans le layout et les chemins `mods/<nom>/` du mod.
2. Ajouter dans `~/.config/herdr-app/keys.json`, section `global`, la ligne `"cmd-shift-y": "mod.open:vault"`. Si cette touche sert déjà, en choisir une autre.
3. Lancer `herdr-app check ~/.config/herdr-app/mods/<mod>` pour `tabs-vault`, `vault`, `contexte`, `cache`, `alertes`, `spaces-virgile` et `agents-virgile`. Si herdr-app est fermé, mettre `HERDR_APP_HOME` sur un dossier vide pour ces vérifications : sinon `check` garde dans `shared.json` ce que le mod y range sans spaces (Spaces efface ainsi les couleurs).
4. L'état (`etat/`) ne s'applique pas à la main : passer par `installer.py --etat-seulement`.
5. Passer au layout avec `herdr-app do layout.switch '{"name":"Herdr-Virgile"}'`, ou par la palette (« Layout: Herdr-Virgile »), ou avec `ctrl-shift-l`. On revient au sien de la même façon. Pour tout retirer, supprimer les fichiers copiés.

## Les plugins Claude Code

Les plugins **ne sont pas dans ce dossier**. Les panneaux lisent seulement ce que les plugins écrivent (le journal de session, leur store) et leur envoient des commandes slash. Il faut donc installer chaque plugin **sur chaque machine où tourne Claude Code**. Sans un plugin, seule la section qui en dépend reste vide ou grisée ; le reste fonctionne.

| Section | Plugin | Sans le plugin |
|---|---|---|
| Session › Sous-agents : plan, phase, avancement | savvy-progress 1.2.1 | Les sous-agents restent listés, mais sans plan ni avancement. |
| Session › Cache et popup Cache : boutons keepwarm (90 min, 6 h, Arrêter) et garde | cache-tax 2.2.1 (il fournit `/keepwarm` et `/cache-tax`) | Les boutons sont grisés. L'état du cache reste calculé à partir du journal. |
| Alertes › Règles | reflect-mod 3.3.0 | La section indique que le plugin n'est pas actif et ne propose aucune règle. « Ajouter une règle » reste utilisable. |
| Alertes › Blast Radius | blast-radius 0.1.0 | Aucune commande n'est retenue. |
| Vault, Alertes › Notifications, le reste de Session | aucun | — |

```sh
claude plugin marketplace add johnnyvizz/claude-kit
claude plugin install savvy-progress@claude-kit

claude plugin marketplace add karanb192/claude-code-mods
claude plugin install cache-tax@claude-code-mods

claude plugin marketplace add bayramannakov/claude-reflect
claude plugin install reflect-mod@claude-reflect-marketplace

# blast-radius : copier d'abord claude-plugins/playground-mods à un endroit durable,
# parce que Claude Code garde le chemin du dossier.
mkdir -p ~/.claude/marketplaces && cp -R claude-plugins/playground-mods ~/.claude/marketplaces/
claude plugin marketplace add ~/.claude/marketplaces/playground-mods
claude plugin install blast-radius@playground-mods
```

## À savoir avant d'installer

Ces mods lancent des programmes et lisent des fichiers hors de leur dossier. Ils n'envoient rien sur le réseau.

- Ils lancent `sh` et `awk` par `exec` et `hc exec`, sur la machine de l'agent suivi. Ils y lisent `~/.claude/sessions/`, `~/.claude/projects/*/*.jsonl`, `~/.claude/settings.json` et `~/.claude/plugins/store/`.
- **Session** lance `claude -p /context --resume <session> --no-session-persistence` dans le dossier de l'agent. C'est une commande locale de Claude Code : elle n'appelle pas le modèle et n'écrit rien dans la session. Elle suppose que `claude` est dans le PATH. Si `CLAUDE_CODE_OAUTH_TOKEN` n'est pas défini et que `~/.config/claude/oauth-token` existe, le script lit ce fichier et passe son jeton à cette seule commande, sur la machine de l'agent. Le bouton `/compact` envoie la commande à la session avec `hc send`.
- **Cache** envoie `/keepwarm …` et `/cache-tax guard …` à la session avec `hc send`.
- **Alertes › Blast Radius** lit l'écran de l'agent avec `hc read` et répond au plugin avec `hc keys` : `1` pour exécuter, `2` pour annuler. **Règles** écrit dans `~/.claude/CLAUDE.md` (ou le CLAUDE.md du projet) et dans le store de reflect-mod. Il vérifie avant d'écrire que le fichier n'a pas changé depuis sa lecture.
- **Vault** range les variables dans `~/.config/herdr-vault/env` (droits 0600) sur chaque machine. Il ajoute une seule fois à `~/.bashrc` / `~/.zshrc` une ligne qui charge ce fichier, et seulement dans les terminaux Herdr (`HC_TERMINAL_ID`).
- L'en-tête renomme les onglets d'après la session Claude Code qui y tourne. Un nom choisi à la main n'est pas touché.

## Limites

- Construit et utilisé sur herdr-app 0.1.12, sous macOS. `tabs-vault`, `spaces-virgile` et `agents-virgile` sont des copies de `tabs`, `spaces` et `agents` de cette version. Sur une version plus récente, ils ne suivent pas les changements des mods livrés.
- L'en-tête de volet est celui livré (`pane`). Le layout d'origine utilisait le sélecteur Chat | Terminal de Shepherdr. Cette copie n'a pas encore été vue dans une fenêtre avec cet en-tête.
- Les sandboxes `sbx` (un outil personnel) sont retirées de Session › Sous-agents.
- `mods/contexte/core/` est le lecteur de journal de Shepherdr (licence MIT, © 2026 Elias Stravik), voir `core/LICENSE-shepherdr`.

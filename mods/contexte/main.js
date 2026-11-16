// Session (l'ancien panneau Contexte ; id et dossier « contexte ») : la session Claude Code du terminal
// actif (ou de l'agent d'un volet de chat), comme le panneau de l'app Claude : Environnement, Contexte
// (fenêtre de contexte, détaillée ou réduite à sa barre), Cache (résumé du panneau Cache), Tâches en
// arrière-plan (shells et moniteurs) et Sous-agents (l'ancien panneau Équipe).
//
// Session : claude.js session(), résolue toutes les 10 s (un /clear change de session, tout repart).
// Contexte : `claude -p /context --resume <session> --no-session-persistence` lancé sur la machine
// de l'agent, dans son dossier. Commande locale de Claude Code : aucun appel au modèle, rien d'écrit
// dans la session. Relancée seulement quand le journal a grandi, ou par « Actualiser ».
// Sous-agents : ceux de Claude Code (sous-agents.js) et les sandboxes sbx de pve-dell lancées par la session
// avec dsbx (sbx.js).
// Cache : cache-etat.js (commun avec le popup Cache, ouvert par « Détails »), avec les boutons keepwarm et garde. Sous-agents : sous-agents.js.
// Tâches : le lecteur de journal du mod chat (copié de chat/core/ dans core/ par vault-setup.py), le même que le chat et
// l'app web : shells et moniteurs encore vivants (leurs processus tiennent le fichier de sortie ouvert),
// arrêtables. Les sous-agents ont leur propre section.
// Ressources : CPU, mémoire et réseau de l'arbre de processus de l'agent et de sa machine entière, toutes
// les 3 s (ressources.js, commun avec le kanban d'agents-virgile) ; réduite à deux lignes comme Contexte.
// Tout ne se lit que quand le panneau est à l'écran (et tout de suite quand il y revient).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, hc, panes, theme, shared, setShared, run } from "herdr";
import { ChatReader, kindOf } from "./core/chat-reader.js";
import { Conversation } from "./core/chat-log.js";
import { cible, session, affiche, dollars, duree, dureeCourte, milliers } from "./claude.js";
import { EtatCache, ORANGE, VERT } from "./cache-etat.js";
import { SousAgents } from "./sous-agents.js";
import { SandboxesSbx } from "./sbx.js";
import { Mesures, mesurer, octets, debit, pourcent, detail, detailMachine, resume, resumeMachine } from "./ressources.js";

const ID = "contexte";              // le mod et son bloc dans panel-body (le panneau s'appelle Session)
const REDUIT = "contexte.reduit";   // section Contexte réduite à sa barre (persisté ; réduite par défaut)
const RES_REDUIT = "contexte.ressources.reduit"; // section Ressources réduite à deux lignes (persisté ; réduite par défaut)

// Les tâches terminées, comptées une fois chacune (par appel ou par tâche) dans le journal lu.
if (!Conversation.prototype.__contexteFinies) {
  const ended = Conversation.prototype.ended;
  Conversation.prototype.ended = function (id, task) {
    (this.finies ??= new Set()).add(String(id ?? task));
    return ended.call(this, id, task);
  };
  Conversation.prototype.__contexteFinies = true;
}

// /context de cette session, avec le modèle qu'elle utilise ($4, sinon celui de son journal).
const CONTEXTE = String.raw`
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || [ ! -r "$HOME/.config/claude/oauth-token" ] || export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.config/claude/oauth-token")"
cd "$2" 2>/dev/null || cd
m="$4"
[ -z "$m" ] && [ -f "$3" ] && m=$(tail -c 400000 "$3" | grep -o '"model":"claude-[^"]*"' | tail -1 | cut -d'"' -f4)
exec claude -p /context --resume "$1" --no-session-persistence --output-format json ${"$"}{m:+--model "$m"} </dev/null`;

const COULEURS = { "Messages": "#3b82f6", "MCP tools": "#f26b3a", "System tools": "#10a37f", "Memory files": "#d4a017" };
const NOMS = {
  "Messages": "Messages", "MCP tools": "Outils MCP", "System tools": "Outils système", "Memory files": "Fichiers mémoire",
  "Skills": "Skills", "System prompt": "Prompt système", "Custom agents": "Agents personnalisés",
  "MCP server instructions": "Instructions des serveurs MCP", "Autocompact buffer": "Réserve d'autocompactage",
  "Free space": "Espace libre", "MCP tools (deferred)": "Outils MCP (différés)", "System tools (deferred)": "Outils système (différés)",
  "MCP Tools": "Outils MCP", "Memory Files": "Fichiers mémoire", "Custom Agents": "Agents personnalisés", "Agents": "Agents personnalisés",
};
const nom = (n) => NOMS[n] ?? n;

// "16.6k" → 16600, "1m" → 1e6, "~350" → 350.
const nombre = (s) => {
  const m = /([\d.,]+)\s*([km]?)/i.exec(String(s ?? "").replace(/[~\s]/g, ""));
  if (!m) return NaN;
  const v = parseFloat(m[1].replace(",", "."));
  return m[2].toLowerCase() === "k" ? v * 1e3 : m[2].toLowerCase() === "m" ? v * 1e6 : v;
};
const court = (v) => (!isFinite(v) ? "—" : v >= 1e6 ? `${+(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
const pct = (v, total) => (total > 0 ? `${(v / total * 100).toFixed(1).replace(".", ",")} %` : "—");
// Le markdown de /context → { model, used, window, cats: [{ name, tokens }], sections: [{ title, rows: [{ name, tokens }] }] }.
function lire(md) {
  const out = { model: null, used: NaN, window: NaN, cats: [], sections: [] };
  const mm = /\*\*Model:\*\*\s*(\S+)/.exec(md); if (mm) out.model = mm[1];
  const tk = /\*\*Tokens:\*\*\s*([\d.,]+[km]?)\s*\/\s*([\d.,]+[km]?)/i.exec(md);
  if (tk) { out.used = nombre(tk[1]); out.window = nombre(tk[2]); }
  let titre = null, rows = null, entete = null;
  const fin = () => {
    if (!titre || !rows) return;
    if (/usage by category/i.test(titre)) out.cats = rows;
    else if (rows.length) out.sections.push({ title: titre, rows });
  };
  for (const l of md.split("\n")) {
    const h = /^#{2,4}\s+(.*)$/.exec(l);
    if (h) { fin(); titre = h[1].trim(); rows = []; entete = null; continue; }
    if (!titre || !l.trim().startsWith("|")) continue;
    const c = l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    if (!entete) { entete = c; continue; }
    const iTok = entete.findIndex((x) => /token/i.test(x));
    const tokens = nombre(c[iTok >= 0 ? iTok : c.length - 1]);
    const name = /^(path|chemin)$/i.test(entete[1] ?? "") && c[1] ? c[1].replace(/^.*\//, "") : c[0];
    rows.push({ name, tokens, extra: c.slice(1, iTok >= 0 ? iTok : c.length - 1).join(" · ") });
  }
  fin();
  return out;
}

// L'icône d'une ligne de la section Ressources réduite, comme celles d'Environnement : au survol, son
// libellé en étiquette au-dessus.
function iconeEnvR(t, vue, cle, nomIcone) {
  return div().id(`env-i-${cle}`).relative().w(10).h(26).flex_none().flex().items_center().justify_center()
    .on_hover((dessus, cx) => { if (dessus) vue.envSurvol = cle; else if (vue.envSurvol === cle) vue.envSurvol = null; cx.notify(); })
    .child(svg(`mods/contexte/${nomIcone}.svg`).size(13).flex_none().text_color(vue.envSurvol === cle ? t.foreground : t.muted))
    .when(vue.envSurvol === cle, (el) => el.child(div().absolute().bottom(22).left(-6).px(7).h(20).flex().items_center().rounded(5)
      .bg(t.foreground).text_color(t.background).text_size(11).font_medium().whitespace_nowrap().child(cle)));
}

export default class Session extends View {
  init(_props, cx) {
    this.addr = null;        // terminal suivi
    this.session = null;     // claude.js session() : { id, cwd, file, size, machine, version, argv, … }
    this.donnees = null;     // /context lu
    this.tailleLue = -1;     // taille du journal au dernier /context
    this.erreur = null;      // pas de session
    this.erreurCtx = null;   // /context a échoué
    this.charge = false;
    this.ouvert = new Set();
    this.note = null;
    this.lecteur = null;     // ChatReader du terminal suivi (tâches en arrière-plan)
    this.cache = new EtatCache();
    this.equipe = new SousAgents();
    this.sbx = new SandboxesSbx();
    this.visible = false;
    this.quand = { session: 0, taches: 0, notif: 0, res: 0 };
    this.mesures = new Mesures(); // ressources.js : CPU, mémoire et réseau de l'arbre de processus de l'agent
    this.res = null;         // l'agent : ressources.js mesurer().agents
    this.resM = null;        // sa machine entière : mesurer().machines
    this.suivre(cx);
    cx.timer.every(1000, (cx) => this.tic(cx));
  }

  // Chaque seconde, panneau à l'écran : ce qui est dû. Au retour à l'écran : tout, tout de suite.
  tic(cx) {
    if (!affiche(ID)) { this.visible = false; return; }
    const m = Date.now(), neuf = !this.visible;
    this.visible = true;
    this.suivre(cx);
    if (neuf || m - this.quand.session >= 10000) this.rafraichir(cx);
    if (neuf || m - this.quand.taches >= 4000) this.taches(cx);
    if (this.session && (neuf || m - this.cache.dernierTour >= 10000)) this.lireCache(cx);
    if (this.session && (neuf || this.equipe.du(m))) this.lireAgents(cx);
    if (this.session && (neuf || m - this.sbx.dernierTour >= 15000)) this.lireSbx(cx);
    if (this.session?.pid && (neuf || m - this.quand.res >= 3000)) this.lireRessources(cx);
    // Les durées avancent chaque seconde quand quelque chose tourne ; le compte à rebours du cache, à la demi-minute.
    if (this.enCours().length || this.equipe.enCours().length || m - this.quand.notif >= 30000) { this.quand.notif = m; cx.notify(); }
  }

  suivre(cx) {
    const a = cible();
    if (!a || a === this.addr) return;
    this.addr = a; this.session = null; this.donnees = null; this.tailleLue = -1;
    this.erreur = null; this.erreurCtx = null; this.note = null; this.res = null; this.resM = null;
    this.cache.viser(null); this.equipe.viser(null); this.sbx.viser(null);
    this.lecteur = new ChatReader({ sh: (script, args, on) => exec("sh", ["-c", script, ...args], { on: on ?? null }) }, a);
    if (affiche(ID)) { this.rafraichir(cx); this.taches(cx); }
  }

  // La section Ressources : l'agent (lui et ce qu'il a lancé) et sa machine entière. Réduite (par
  // défaut, comme Contexte) : une ligne chacun ; dépliée : processeur, mémoire et réseau de chacun,
  // avec la part de la machine en petite barre. Un clic sur le titre bascule.
  ressources(t, ressource) {
    const reduit = (shared(RES_REDUIT) ?? true) === true;
    const A = this.res, M = this.resM, S = this.session;
    const nomMachine = S?.machine ?? "Cet ordinateur";
    const mesure = (x, f) => (x == null ? "mesure…" : f(x));
    const out = [h_flex().id("ressources-bascule").px(14).pt(14).pb(8).gap(6).items_center().cursor_pointer()
      .tooltip(reduit ? "Afficher le détail" : "Réduire à deux lignes")
      .on_click((_e, cx) => { setShared(RES_REDUIT, !reduit); cx.notify(); })
      .child(div().text_size(12).font_semibold().text_color(t.muted).child("Ressources"))
      .child(svg(`mods/files/chevron-${reduit ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim))];
    const sous = (texte) => div().px(14).pt(4).pb(2).text_size(11).text_color(t.dim).truncate().child(texte);
    if (reduit) {
      // Une ligne pour l'agent, une pour la machine, en colonnes : CPU, mémoire, réseau (le détail
      // en infobulle ; au survol de l'icône, de qui il s'agit).
      const court = (x) => (x == null ? "…" : debit(x).replace(" ", "\u202f"));
      const ligne = (cle, nomIcone, cpu, ram, rx, tx, aide) => h_flex().id(`env-${cle}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
        .text_size(12.5).tooltip(aide)
        .child(iconeEnvR(t, this, cle, nomIcone))
        .child(div().w(44).flex_none().truncate().child(cpu))
        .child(div().w(74).flex_none().truncate().child(ram))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`↓${court(rx)} ↑${court(tx)}`));
      if (A?.erreur) out.push(ressource("Cet agent", "bot", `illisibles : ${A.erreur}`, null));
      else if (A) out.push(ligne("Cet agent", "bot", mesure(A.cpu, pourcent), octets(A.rss), A.rx, A.tx, `Cet agent : ${resume(A)}\n${detail(A)}`));
      if (M?.erreur) out.push(ressource(`Machine · ${nomMachine}`, "monitor", `illisible : ${M.erreur}`, null));
      else if (M) out.push(ligne(`Machine · ${nomMachine}`, "monitor", mesure(M.cpu, pourcent), `${octets(M.utilisee).replace(/ Go$/, "")}/${octets(M.total)}`, M.rx, M.tx, `Machine · ${nomMachine} : ${resumeMachine(M)}\n${detailMachine(M)}`));
      return out;
    }
    if (A && A.erreur) out.push(ressource("Cet agent", "bot", `illisibles : ${A.erreur}`, null));
    else if (A) out.push(
      sous(`Cet agent · ${A.nproc} processus`),
      ressource("Processeur (agent)", "cpu", `${mesure(A.cpu, pourcent)} d'un cœur`, A.cpu == null ? null : A.cpu / 100 / (A.machine?.cpus || 1), detail(A)),
      ressource("Mémoire (agent)", "memory-stick", `${octets(A.rss)}${A.machine?.total ? ` · ${pourcent(A.rss / A.machine.total * 100)} de la machine` : ""}`, A.machine?.total ? A.rss / A.machine.total : null, detail(A)),
      ressource("Réseau (agent)", "arrow-down-up", A.rx == null ? "mesure…" : `↓ ${debit(A.rx)} · ↑ ${debit(A.tx)}`, null, detail(A)));
    if (M && M.erreur) out.push(ressource(`Machine · ${nomMachine}`, "monitor", `illisible : ${M.erreur}`, null));
    else if (M) out.push(
      sous(`Machine · ${nomMachine} · ${M.cpus} cœur${M.cpus > 1 ? "s" : ""}`),
      ressource("Processeur (machine)", "cpu", `${mesure(M.cpu, pourcent)}${M.charge != null ? ` · charge ${String(M.charge.toFixed(2)).replace(".", ",")}` : ""}`, M.cpu == null ? null : M.cpu / 100, detailMachine(M)),
      ressource("Mémoire (machine)", "memory-stick", `${octets(M.utilisee)} / ${octets(M.total)} · ${pourcent(M.utilisee / (M.total || 1) * 100)}`, M.total ? M.utilisee / M.total : null, detailMachine(M)),
      ressource("Réseau (machine)", "arrow-down-up", M.rx == null ? `${M.iface || "?"} · mesure…` : `${M.iface || "?"} · ↓ ${debit(M.rx)} · ↑ ${debit(M.tx)}`, null, detailMachine(M)));
    return out;
  }

  // Ce que l'agent consomme (toutes les 3 s, panneau à l'écran) : CPU, mémoire, réseau de son arbre de processus.
  lireRessources(cx) {
    if (this.lisRes) return;
    const addr = this.addr, S = this.session;
    this.lisRes = true;
    this.quand.res = Date.now();
    cx.spawn(async (cx) => {
      try {
        const r = await mesurer(this.mesures, [{ cle: addr, pid: S.pid, machine: S.machine }]);
        if (this.addr === addr) { this.res = r.agents[addr]; this.resM = r.machines[S.machine ?? ""] ?? null; }
      } finally {
        this.lisRes = false;
        cx.notify();
      }
    });
  }

  // La session (toutes les 10 s), puis /context si le journal a grandi.
  rafraichir(cx, force = false) {
    if (this.charge || !this.addr) return;
    const addr = this.addr;
    this.charge = true;
    this.quand.session = Date.now();
    cx.spawn(async (cx) => {
      try {
        const s = await session(addr);
        if (this.addr !== addr) return;
        if (s.erreur) {
          this.session = null; this.donnees = null; this.tailleLue = -1; this.erreur = s.erreur;
          this.cache.viser(null); this.equipe.viser(null); this.sbx.viser(null);
          return;
        }
        const autre = !this.session || this.session.id !== s.id || this.session.machine !== s.machine;
        this.session = s; this.erreur = null;
        this.cache.viser(s); this.equipe.viser(s); this.sbx.viser(s.id);
        if (autre) { this.donnees = null; this.tailleLue = -1; this.erreurCtx = null; this.lireCache(cx); this.lireAgents(cx); this.lireSbx(cx); }
        cx.notify();
        if (!force && this.tailleLue === s.size) return;
        const argv = s.argv ?? [];
        const im = argv.findIndex((x) => x === "--model");
        const model = im >= 0 ? argv[im + 1] ?? "" : (argv.find((x) => x.startsWith("--model=")) ?? "").slice(8);
        const r = await exec("sh", ["-c", CONTEXTE, "contexte", s.id, s.cwd, s.file, model], { on: s.machine, timeout: 90000 });
        if (this.addr !== addr || this.session?.id !== s.id) return;
        // Réussi ou non, pas de nouvel essai avant que le journal grandisse (ou « Actualiser »).
        this.tailleLue = s.size;
        let j = null;
        try { j = JSON.parse(r.stdout); } catch {}
        if (!j || j.is_error || typeof j.result !== "string") {
          this.erreurCtx = `/context a échoué : ${(r.stderr || j?.result || r.stdout || "").trim().slice(0, 200)}`;
          return;
        }
        this.donnees = lire(j.result); this.erreurCtx = null;
      } catch (e) {
        if (this.addr === addr) { if (this.session) this.erreurCtx = String(e).slice(0, 200); else this.erreur = String(e).slice(0, 200); }
      } finally {
        this.charge = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  lireCache(cx) {
    if (this.lisCache || !this.cache.sess) return;
    this.lisCache = true;
    this.cache.dernierTour = Date.now();
    cx.spawn(async (cx) => {
      try { await this.cache.lire(); } catch (e) { this.cache.erreur = String(e).slice(0, 200); } finally { this.lisCache = false; cx.notify(); }
    });
  }

  lireAgents(cx) {
    if (this.lisAgents || !this.equipe.sess) return;
    this.lisAgents = true;
    this.equipe.dernierTour = Date.now();
    cx.spawn(async (cx) => {
      try { await this.equipe.lire(); } catch (e) { this.equipe.erreur = String(e).slice(0, 200); } finally { this.lisAgents = false; cx.notify(); }
    });
  }

  // Les sandboxes sbx de la session, lues sur pve-dell (à part : pve-dell injoignable ne gêne rien d'autre).
  lireSbx(cx) {
    if (this.lisSbx || !this.sbx.session) return;
    this.lisSbx = true;
    this.sbx.dernierTour = Date.now();
    cx.spawn(async (cx) => {
      try { await this.sbx.lire(); } catch (e) { this.sbx.erreur = String(e).slice(0, 160); } finally { this.lisSbx = false; cx.notify(); }
    });
  }

  toutRelire(cx) {
    this.lireSbx(cx);
    this.rafraichir(cx, true);
    this.taches(cx);
    this.lireCache(cx);
    this.lireAgents(cx);
  }

  // Le journal de la session (ses nouvelles lignes) et les processus de l'agent : les tâches.
  taches(cx) {
    const L = this.lecteur;
    if (!L || this.lit) return;
    this.lit = true;
    this.quand.taches = Date.now();
    cx.spawn(async (cx) => {
      try {
        let t = null;
        try { t = JSON.parse((await hc(["get", L.addr, "--json"])).stdout || "null"); } catch {}
        if (kindOf(t) !== "claude") return;
        await L.locate(t);
        await L.pull();
        await L.lookJobs();
      } catch {} finally {
        this.lit = false;
        if (L === this.lecteur) cx.notify();
      }
    });
  }

  // Shells et moniteurs encore vivants : [{ id, kind: "shell" | "monitor", label, at, job }]. Les
  // sous-agents sont dans leur section.
  enCours() {
    const L = this.lecteur;
    if (!L?.conv) return [];
    return L.jobs().map((j) => ({ id: j.id, kind: j.kind === "monitor" ? "monitor" : "shell", label: j.label || j.cmd || "shell", at: j.at, job: j }))
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }

  arreter(id, cx) {
    const L = this.lecteur;
    if (!L) return;
    cx.spawn(async (cx) => {
      const ok = await L.stopJob(id).catch(() => false);
      this.note = ok ? "Tâche arrêtée." : "Cette tâche est déjà terminée.";
      await L.lookJobs().catch(() => {});
      cx.notify();
    });
  }

  envoyer(texte, cx) {
    if (!this.addr) return;
    const addr = this.addr;
    cx.spawn(async (cx) => {
      const r = await hc(["send", addr, texte]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.note = r.code === 0 ? `${texte} envoyé à la session.` : `Échec de ${texte} : ${(r.stderr || "").trim().slice(0, 160)}`;
      this.cache.dernierTour = 0;
      cx.notify();
    });
  }

  compacter(cx) {
    if (!this.addr) return;
    const addr = this.addr;
    cx.spawn(async (cx) => {
      const r = await hc(["send", addr, "/compact"]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.note = r.code === 0 ? "/compact envoyé à la session." : `Échec de /compact : ${(r.stderr || "").trim().slice(0, 160)}`;
      cx.notify();
    });
  }

  basculer(titre, cx) {
    if (this.ouvert.has(titre)) this.ouvert.delete(titre); else this.ouvert.add(titre);
    cx.notify();
  }

  // Le résumé du cache : l'état, ce que coûte un envoi à froid face à un tour à chaud, keepwarm, les
  // réécritures payées, et l'alerte de cache-tax. Le reste (boutons keepwarm, garde) : panneau Cache.
  resumeCache(t, maintenant) {
    const E = this.cache;
    if (!E.lu) return [div().mx(14).h(24).text_size(12).text_color(E.erreur ? t.ansi1 : t.dim).child(E.erreur ?? "Lecture du journal…")];
    const c = E.calcul(maintenant);
    const sous = c.etat === "garde" ? `dernier envoi il y a ${dureeCourte(c.ecoule)}`
      : c.etat === "inconnu" ? (c.compacteApres ? "session compactée" : "aucun envoi lu") : c.sousEtat;
    const valeur = (cle, val, ton) => h_flex().id(`cr-${cle}`).h(24).flex_none().mx(6).px(8).gap(8).items_center()
      .child(div().w(10).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(cle))
      .child(div().flex_none().text_size(12).text_color(ton ?? t.foreground).child(val));
    const out = [
      h_flex().id("cr-etat").h(26).flex_none().mx(6).px(8).gap(8).items_center()
        .child(div().size(10).flex_none().rounded(5).bg(c.couleur ?? t.dim))
        .child(div().flex_none().font_semibold().child(c.mot))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(sous))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`cache ${c.ttlMot}`)),
    ];
    // Les commandes du plugin, envoyées à la session comme si on les tapait (les prix, l'explication et les
    // réécritures : popup Cache, par « Détails »).
    const ok = E.plugin !== false;
    const bouton = (id, texte, commande, actif = false, permis = true) => div().id(id).h(24).px(8).flex().items_center().rounded(6)
      .border_1().border_color(actif ? t.accent : t.border).text_size(11.5)
      .text_color(ok && permis ? (actif ? t.foreground : t.muted) : t.dim).when(actif, (e) => e.bg(t.selected))
      .when(ok && permis, (e) => e.cursor_pointer().hover((x) => x.bg(t.hover)).on_click((_e, cx) => this.envoyer(commande, cx)))
      .child(texte);
    // Un intitulé et son état (comme les autres lignes), puis ses boutons en dessous, sous l'intitulé.
    const groupe = (id, cle, etat, tonEtat, boutons) => v_flex().id(id).flex_none().pb(4)
      .child(valeur(cle, etat, tonEtat))
      .child(h_flex().flex_none().pl(32).pr(14).gap(6).items_center().flex_wrap().children(boutons));
    out.push(groupe("cr-kw", "Keepwarm", c.arme ? `${dureeCourte(c.deadline - maintenant)} restantes` : "arrêté", c.arme ? VERT : t.dim, [
      bouton("cr-kw-90", "90 min", "/keepwarm 90m"),
      bouton("cr-kw-6h", "6 h", "/keepwarm"),
      bouton("cr-kw-off", "Arrêter", "/keepwarm off", false, c.arme || c.toujours),
    ]));
    out.push(groupe("cr-garde", "Garde", c.garde === "refuse" ? "bloque une fois" : "avertit seulement", t.muted, [
      bouton("cr-g-warn", "Avertir seulement", "/cache-tax guard warn", c.garde === "warn"),
      bouton("cr-g-refuse", "Bloquer", "/cache-tax guard refuse", c.garde === "refuse"),
    ]));
    if (E.manques.length) out.push(valeur("Réécritures payées", `${E.manques.length} · ≈${dollars(c.paye)}`));
    if (E.plugin === false) out.push(div().mx(14).pt(2).text_size(11.5).text_color(t.dim).child(`cache-tax n'est pas actif sur ${this.session?.machine ?? "cette machine"}`));
    if (c.alerte) out.push(div().mx(14).mt(6).p(8).rounded(8).border_1().border_color(ORANGE).text_size(12)
      .child(c.garde === "refuse"
        ? `Le prochain message sera bloqué une fois par cache-tax : il réécrirait ${milliers(c.ctx)} tokens (≈${dollars(c.froidUsd)}).`
        : `Le prochain message réécrira ${milliers(c.ctx)} tokens (≈${dollars(c.froidUsd)}).`));
    return out;
  }

  render(cx) {
    this.suivre(cx);
    const t = theme(), d = this.donnees, S = this.session, maintenant = Date.now();
    const reduit = (shared(REDUIT) ?? true) === true;
    const fenetre = d?.window, utilise = d?.used;
    const cats = d?.cats ?? [];
    const differe = (c) => /deferred/i.test(c.name);
    const couleur = (c) => COULEURS[c.name] ?? (c.name === "Free space" ? t.border : c.name === "Autocompact buffer" ? t.dim : t.muted);
    // Comme Claude : les plus gros postes d'abord, puis la réserve d'autocompactage et l'espace libre.
    const rang = (c) => (c.name === "Free space" ? 2 : c.name === "Autocompact buffer" ? 1 : 0);
    const principales = cats.filter((c) => !differe(c)).sort((a, b) => rang(a) - rang(b) || b.tokens - a.tokens);
    const libre = cats.find((c) => c.name === "Free space")?.tokens;
    const barre = principales.filter((c) => c.name !== "Free space" && c.tokens > 0);
    const titre = (texte) => div().px(14).pt(14).pb(8).text_size(12).font_semibold().text_color(t.muted).child(texte);
    const lien = (id, texte, action) => div().id(id).pt(6).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx)).child(texte);
    const sep = () => div().h(1).flex_none().mx(14).mt(12).bg(t.border);
    const ligne = (c, i) => h_flex().id(`c-${i}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7).hover((s) => s.bg(t.hover))
      .child(div().size(10).flex_none().rounded(2).bg(differe(c) ? t.border : couleur(c)))
      .child(div().flex_1().min_w(0).truncate().text_color(differe(c) ? t.muted : t.foreground).child(nom(c.name)))
      .child(div().w(56).text_right().text_size(12).text_color(t.muted).child(court(c.tokens)))
      .child(div().w(56).text_right().text_size(12).text_color(t.dim).child(differe(c) ? "—" : pct(c.tokens, fenetre)));
    const section = (s, i) => {
      const ouvert = this.ouvert.has(s.title);
      return v_flex().flex_none().mx(6)
        .child(h_flex().id(`s-${i}`).h(26).px(8).gap(7).items_center().rounded(7).cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => this.basculer(s.title, cx))
          .child(svg(`mods/files/chevron-${ouvert ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().child(nom(s.title)))
          .child(div().text_size(12).text_color(t.dim).child(String(s.rows.length))))
        .when(ouvert, (el) => el.children(s.rows.map((r, k) => h_flex().id(`s-${i}-${k}`).h(24).pl(27).pr(8).gap(8).items_center()
          .tooltip(r.extra ? `${r.name} · ${r.extra}` : r.name)
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(r.name))
          .child(div().text_size(12).text_color(t.dim).child(court(r.tokens))))));
    };
    // Comme les lignes de Contexte : même retrait, une icône dans la colonne des carrés, la valeur là
    // où commencent les noms des catégories. Au survol de l'icône, son libellé en étiquette au-dessus.
    const etiquette = (cle) => div().absolute().bottom(22).left(-6).px(7).h(20).flex().items_center().rounded(5)
      .bg(t.foreground).text_color(t.background).text_size(11).font_medium().child(cle);
    const iconeEnv = (cle, nomIcone, h) => div().id(`env-i-${cle}`).relative().w(10).h(h).flex_none().flex().items_center().justify_center()
      .on_hover((dessus, cx) => { if (dessus) this.envSurvol = cle; else if (this.envSurvol === cle) this.envSurvol = null; cx.notify(); })
      .child(svg(`mods/contexte/${nomIcone}.svg`).size(13).flex_none().text_color(this.envSurvol === cle ? t.foreground : t.muted))
      .when(this.envSurvol === cle, (el) => el.child(etiquette(cle)));
    const info = (cle, nomIcone, val) => h_flex().id(`env-${cle}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
      .child(iconeEnv(cle, nomIcone, 26))
      .child(div().id(`env-v-${cle}`).flex_1().min_w(0).truncate().tooltip(`${cle} : ${val}`).child(val));
    // Une ligne de ressource : comme info(), avec une petite barre (part de la machine) et le détail en infobulle.
    const ressource = (cle, nomIcone, val, part, plus = "") => h_flex().id(`env-${cle}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
      .child(iconeEnv(cle, nomIcone, 26))
      .child(div().id(`env-v-${cle}`).flex_1().min_w(0).truncate().tooltip(plus ? `${cle} : ${val}\n${plus}` : `${cle} : ${val}`).child(val))
      .when(part != null, (el) => el.child(div().w(48).h(4).flex_none().rounded(2).bg(t.hover)
        .child(div().h_full().rounded(2).bg(part > 0.8 ? ORANGE : t.accent).w(`${Math.max(2, Math.min(100, Math.round(part * 100)))}%`))));
    const branche = panes().find((p) => p.terminal === this.addr)?.branch ?? null;
    const taches = this.enCours();
    // Terminées : les shells et moniteurs (les sous-agents ont leur section).
    const conv = this.lecteur?.conv;
    // (Un sous-agent se termine par son appel Agent, ou par une notification qui ne donne que son id : agent-<id>.)
    const finies = conv?.finies ? [...conv.finies].filter((id) => !conv.helpers?.has(id) && !this.equipe.agents.has(id)).length : 0;
    const icone = (k) => (k === "monitor" ? "mods/contexte/eye.svg" : "mods/contexte/terminal.svg");
    const tache = (x) => h_flex().id(`t-${x.id}`).h(28).flex_none().mx(6).px(8).gap(8).items_center().rounded(7).hover((s) => s.bg(t.hover))
      .tooltip(x.job?.cmd ?? x.label)
      .child(svg(icone(x.kind)).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(x.label))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(x.at ? duree(maintenant - x.at) : ""))
      .when(Boolean(x.job), (el) => el.child(div().id(`stop-${x.id}`).size(18).flex_none().flex().items_center().justify_center()
        .rounded(4).cursor_pointer().hover((s) => s.bg(t.raised)).tooltip("Arrêter cette tâche")
        .on_click((_e, cx) => this.arreter(x.id, cx))
        .child(div().size(9).rounded(2).bg(t.foreground))));
    const vide = this.erreur || (this.addr ? "Lecture de la session…" : "Sélectionnez un terminal Claude Code.");

    return v_flex().id("contexte").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .when(!S, (el) => el.child(div().p(14).text_size(12).text_color(t.dim).child(vide)))
      .when(Boolean(S), (el) => el
        .child(div().flex_1().min_h(0).relative()
          .child(v_flex().id("contexte-liste").absolute().inset_0().overflow_y_scroll().pb(10)
            // Environnement
            .child(titre("Environnement"))
            .child(h_flex().id("env-machine").h(28).flex_none().mx(6).px(8).gap(8).items_center()
              .child(iconeEnv("Machine · terminal", "monitor", 28))
              .child(div().flex_1().min_w(0).truncate().font_semibold()
                .child(`${S?.machine ?? "Ce serveur"} · ${this.addr?.split("/").pop() ?? ""}`)))
            .child(info("Dossier", "folder", S?.cwd || "—"))
            .when(Boolean(branche), (x) => x.child(info("Branche", "branch", branche)))
            .child(info("Modèle", "sparkle", d?.model ?? this.cache.der?.modele ?? "—"))
            .child(info("Session", "hash", S?.id ?? "—"))
            .when(Boolean(S?.version), (x) => x.child(info("Version", "tag", `Claude Code ${S.version}`)))
            .when(Boolean(this.res || this.resM), (x) => x.child(sep()).children(this.ressources(t, ressource)))
            .child(sep())
            // Contexte : la barre, et le détail par poste sauf en mode réduit (clic sur le titre).
            .child(h_flex().items_center().pr(14)
              .child(h_flex().id("contexte-bascule").flex_1().px(14).pt(14).pb(8).gap(6).items_center().cursor_pointer()
                .tooltip(reduit ? "Afficher le détail" : "Réduire à la barre")
                .on_click((_e, cx) => { setShared(REDUIT, !reduit); cx.notify(); })
                .child(div().text_size(12).font_semibold().text_color(t.muted).child("Contexte"))
                .child(svg(`mods/files/chevron-${reduit ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim)))
              .child(lien("contexte-maj", this.charge ? "…" : "Actualiser", (cx) => this.toutRelire(cx))))
            .when(!d, (x) => x.child(div().mx(14).pb(4).text_size(12).text_color(this.erreurCtx ? t.ansi1 : t.dim)
              .child(this.erreurCtx ?? "Lecture de /context…")))
            .when(Boolean(d), (x) => x
              .child(v_flex().flex_none().mx(14).pb(8).gap(8)
                .child(h_flex().items_center()
                  .child(div().flex_1().font_semibold().child(`${isFinite(utilise / fenetre) ? Math.round(utilise / fenetre * 100) : "?"} % utilisé`))
                  .child(div().text_size(12).text_color(t.muted).child(`${court(utilise)} / ${court(fenetre)}`)))
                .child(h_flex().h(6).w_full().rounded(3).overflow_hidden().bg(t.raised)
                  .children(barre.map((c) => div().h_full().flex_none().w(`${Math.max(0.4, c.tokens / fenetre * 100).toFixed(2)}%`).bg(couleur(c))))))
              .when(!reduit, (x) => x
                .children(principales.map(ligne))
                .when(cats.some(differe), (x) => x.child(div().h(8).flex_none())
                  .children(cats.filter(differe).map((c, i) => ligne(c, 100 + i))))
                .when(d.sections.length > 0, (x) => x.child(div().h(8).flex_none()).children(d.sections.map(section))))
              .when(Boolean(this.erreurCtx), (x) => x.child(div().mx(14).pt(4).text_size(11).text_color(t.ansi1).child(this.erreurCtx))))
            .child(h_flex().flex_none().mx(14).pt(reduit ? 2 : 10).gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted)
                .child(isFinite(libre) ? `${court(libre)} avant autocompactage` : ""))
              .child(div().id("compacter").h(28).px(12).flex().items_center().rounded(7).border_1().border_color(t.border)
                .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.compacter(cx)).child("Compacter la session")))
            .child(sep())
            // Cache (résumé ; le détail et les boutons : panneau Cache)
            .child(h_flex().items_center().pr(14).child(div().flex_1().child(titre("Cache")))
              .child(lien("cache-details", "Détails", () => run("mod.open", { name: "cache" }))))
            .children(this.resumeCache(t, maintenant))
            .child(sep())
            // Tâches en arrière-plan
            .child(titre("Tâches en arrière-plan"))
            .children(taches.map(tache))
            .when(!taches.length, (x) => x.child(div().mx(14).h(24).text_size(12).text_color(t.dim).child("Aucune tâche en cours")))
            .child(h_flex().id("finies").h(28).flex_none().mx(6).px(8).gap(8).items_center()
              .child(svg("mods/contexte/check.svg").size(14).flex_none().text_color(t.muted))
              .child(div().text_size(12.5).text_color(t.muted).child(`Terminées : ${finies}`)))
            .child(sep())
            // Sous-agents (l'ancien panneau Équipe)
            .child(titre("Sous-agents"))
            .children(this.equipe.elements(t, maintenant, this.sbx.elements(t, maintenant))))
          .child(Scrollbar.vertical("contexte-liste").absolute().inset_0()))
        .when(Boolean(this.note), (x) => x.child(div().px(12).py(6).text_size(11).text_color(t.dim).child(this.note))));
  }
}

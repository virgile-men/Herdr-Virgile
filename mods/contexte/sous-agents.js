// Sous-agents (l'ancien panneau Équipe) : les sous-agents de la session Claude Code que suit le panneau
// Session, comme le panneau « Agents » du mod Claude savvy-progress : en cours, terminés et prévus, avec
// modèle, effort, contexte, tokens, coût estimé et durée, plus la barre de progression du flow savvy.
//
// Lu de l'extérieur, sans rien demander au modèle : les journaux des sous-agents
// (<session>/subagents/agent-*.jsonl et .meta.json, « finished » une fois fini) et, dans le journal
// principal, les appels à mcp__savvy-progress__progress (le plan, la phase, les tâches acceptées).
// L'avancement propre à chaque sous-agent vient de ses appels à mcp__savvy-progress__step.
// Ces deux outils sont ceux du plugin Claude savvy-progress : il doit rester installé pour qu'ils existent.
// Lecture par morceaux (seulement ce que les fichiers ont gagné) ; c'est Session qui dit quand lire.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { sh, AGREGE, lireAgrege, cout, fenetre, nomModele, tokens, dollars, duree } from "./claude.js";

const PHASES = ["plan", "design", "delegate", "review", "close"];
const TIERS = ["fable", "heavy", "careful", "medium", "light"];
const MAX_TASKS = 200, MAX_AFTER = 20, MAX_TITLE = 120;
const COULEUR_TIER = { fable: "#7F77DD", heavy: "#D85A30", careful: "#BA7517", medium: "#378ADD", light: "#1D9E75", other: "#888780" };
const MODELE_TIER = { fable: ["Fable", "high"], heavy: ["Opus", "xhigh"], careful: ["Opus", "high"], medium: ["Opus", "medium"], light: ["Opus", "low"] };
const ACCENT = "#8f8cf4", FINI = "#5fbf8f";
const PHASE_MOT = { plan: "Plan", design: "Conception", delegate: "Tâches", review: "Revue", close: "Terminé" };

// Le journal principal (appels de progression) puis chaque sous-agent : sa fiche et ce que son journal a gagné.
// Args : <journal> <depuis> <dossier subagents> puis "<id>=<depuis>=<dernier id>" pour ceux déjà lus.
const LECTURE = AGREGE + String.raw`
f="$1"; o="$2"; d="$3"; shift 3
if [ -f "$f" ]; then
  [ "$(wc -c < "$f" | tr -d ' ')" -lt "$o" ] && o=0
  e=$(fin_entiere "$f" "$o"); [ "$e" -lt "$o" ] && e="$o"
  echo "== principal"; echo "E $e $o"
  [ "$e" -gt "$o" ] && morceau "$f" "$o" "$e" | LC_ALL=C grep -F '"name":"mcp__savvy-progress__progress","input"' | LC_ALL=C grep -F '"type":"tool_use"' | LC_ALL=C awk '{ print "P\t" $0 }'
fi
for m in "$d"/agent-*.meta.json; do
  [ -f "$m" ] || continue
  id=$(basename "$m" .meta.json | sed 's/^agent-//')
  o=0; last=""
  for a in "$@"; do case "$a" in "$id="*) o=$(echo "$a" | cut -d= -f2); last=$(echo "$a" | cut -d= -f3);; esac; done
  printf '== agent\t%s\t' "$id"; tr -d '\n' < "$m"; echo
  agrege "$d/agent-$id.jsonl" "$o" "$last" 0
done
true`;

const clip = (s, max) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tierNom = (v) => { const t = String(v ?? "").replace(/^savvy-/, "").trim().toLowerCase(); return TIERS.includes(t) ? t : ""; };
// `savvy-careful`, ou `savvy-flow:savvy-careful` quand les agents viennent d'un plugin.
const tierDe = (type) => {
  const nu = String(type ?? "").replace(/^[^:]*:/, "");
  const t = nu.replace(/^savvy-/, "").toLowerCase();
  return Object.hasOwn(COULEUR_TIER, t) && nu.startsWith("savvy-") ? t : "other";
};

// Le flow, comme savvy-progress le tient à partir de ses appels successifs (les champs absents gardent leur valeur).
const vierge = () => ({ title: "savvy-flow", total: 0, done: 0, phase: "plan", isFinished: false, tasks: [] });
const nouveauFlow = (prev, input) => !prev || prev.isFinished || (input.title !== undefined && clip(String(input.title).trim(), MAX_TITLE) !== prev.title);
const tachesPropres = (tasks) => Array.isArray(tasks)
  ? tasks.filter((t) => String(t?.title ?? "").trim()).slice(0, MAX_TASKS).map((t) => ({
    title: String(t.title).trim(), tier: tierNom(t.tier),
    after: (Array.isArray(t.after) ? t.after : []).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
  }))
  : undefined;
function fusion(prev, input) {
  const base = nouveauFlow(prev, input) || !prev ? vierge() : { ...vierge(), ...prev };
  const tasks = tachesPropres(input.tasks) ?? base.tasks;
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))));
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)));
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase;
  return { ...base, title: clip(String(input.title ?? "").trim() || base.title, MAX_TITLE), total, done,
    phase: input.finished ? "close" : phase, isFinished: input.finished === true, tasks };
}

export class SousAgents {
  constructor() {
    this.gen = 0;
    this.finisOuverts = null; // null : ouverts s'il y en a peu
    this.repart(null);
  }

  repart(S) {
    this.gen += 1;
    this.sess = S ?? null;
    this.lu = false;
    this.erreur = null;
    this.principal = 0;      // octet lu du journal principal
    this.appels = [];        // appels de progression, dans l'ordre
    this.agents = new Map(); // id → fiche
    this.dernierTour = 0;
  }

  // Même session (id, machine, journal) : on garde ce qui est lu ; une autre : on repart.
  viser(S) {
    const cle = (s) => (s ? `${s.machine ?? ""}|${s.id}|${s.file}` : "");
    if (cle(S) === cle(this.sess)) { if (S) this.sess = S; return; }
    this.repart(S);
  }

  // À relire : toutes les 3 s tant qu'un sous-agent tourne, sinon toutes les 15 s.
  du(maintenant = Date.now()) {
    return Boolean(this.sess?.file) && maintenant - this.dernierTour >= (this.enCours().length ? 3000 : 15000);
  }

  async lire() {
    const S = this.sess, gen = this.gen;
    if (!S?.file) return;
    this.dernierTour = Date.now();
    const dossier = S.file.replace(/\.jsonl$/, "") + "/subagents";
    const connus = [...this.agents.values()].map((a) => `${a.id}=${a.fin}=${a.dernier}`);
    const r = await sh(LECTURE, [S.file, String(this.principal), dossier, ...connus], S.machine, 30000);
    if (gen !== this.gen) return;
    this.absorber(r.stdout);
    this.erreur = r.code === 0 ? null : (r.stderr || "").trim().slice(0, 200) || null;
    this.lu = true;
  }

  absorber(texte) {
    const parts = String(texte ?? "").split(/^== /m).slice(1);
    for (const p of parts) {
      const nl = p.indexOf("\n");
      const tete = p.slice(0, nl), corps = p.slice(nl + 1);
      if (tete === "principal") {
        const g = lireAgrege(corps);
        this.principal = g.fin;
        this.appels.push(...g.appels.filter((x) => x.outil === "progress"));
        continue;
      }
      const [, id, metaTexte] = tete.split("\t");
      let meta = {};
      try { meta = JSON.parse(metaTexte); } catch {}
      const a = this.agents.get(id) ?? { id, fin: 0, dernier: "", debut: null, vu: null, modele: "", effort: "", tokens: 0, cout: 0, ctx: 0, requetes: 0, pas: null };
      a.meta = meta;
      const g = lireAgrege(corps);
      if (g.premier && !a.debut) a.debut = g.premier;
      for (const x of g.reponses) {
        const u = x.u;
        a.modele = x.modele || a.modele;
        a.effort = x.effort || a.effort;
        a.tokens += u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
        a.cout += cout(a.modele, u, true);
        a.ctx = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens;
        a.requetes += 1;
        a.vu = Math.max(a.vu ?? 0, x.at);
      }
      for (const c of g.appels) {
        if (c.outil !== "step") continue;
        const e = c.entree ?? {};
        const total = Math.max(0, Math.round(e.total ?? a.pas?.total ?? 0));
        const fait = Math.max(0, Math.round(e.done ?? a.pas?.done ?? 0));
        a.pas = { total, done: total ? Math.min(total, fait) : fait, note: String(e.note ?? "").trim() || null };
      }
      if (!g.manquant) { a.fin = g.fin; a.dernier = g.dernier; }
      this.agents.set(id, a);
    }
  }

  // Le flow : les appels de progression rejoués dans l'ordre, comme le plugin les fusionne.
  flow() {
    let f = null;
    for (const c of this.appels) f = fusion(f, c.entree ?? {});
    return f;
  }

  liste() {
    const l = [...this.agents.values()].map((a) => ({
      ...a,
      type: a.meta?.agentType ?? "",
      description: a.meta?.description ?? a.id,
      enCours: a.meta?.finished !== true,
      fond: a.meta?.requestShape === "background",
    }));
    l.sort((x, y) => (x.debut ?? 0) - (y.debut ?? 0));
    // Tour : combien de fois cette description a déjà servi.
    const vus = new Map();
    for (const a of l) { const k = norm(a.description); vus.set(k, (vus.get(k) ?? 0) + 1); a.tour = vus.get(k); }
    return l;
  }

  enCours() { return this.liste().filter((a) => a.enCours); }

  // Les lignes de la section « Sous-agents », sous son titre, à ajouter à la liste de Session.
  // sbx : les groupes de sandboxes (sbx.js), placés après les sous-agents en cours (enCours) et à la fin (fin).
  elements(t, maintenant = Date.now(), sbx = { enCours: [], fin: [] }) {
    const toutes = this.liste();
    const enCours = toutes.filter((a) => a.enCours).reverse();
    const finis = toutes.filter((a) => !a.enCours).reverse();
    const f = this.flow();
    const lances = new Set(toutes.map((a) => norm(a.description)));
    const prevus = f && !f.isFinished ? f.tasks.map((x, i) => ({ ...x, n: i + 1 })).filter((x) => !lances.has(norm(x.title))) : [];
    const fin = (a) => (a.enCours ? maintenant : a.vu ?? a.debut ?? maintenant);
    const cumul = {
      cout: toutes.reduce((s, a) => s + a.cout, 0),
      tokens: toutes.reduce((s, a) => s + a.tokens, 0),
      temps: toutes.length ? Math.max(...toutes.map(fin)) - Math.min(...toutes.map((a) => a.debut ?? maintenant)) : 0,
    };
    const finisOuverts = this.finisOuverts ?? finis.length <= 6;

    const sousTitre = (texte) => div().px(14).pt(10).pb(4).text_size(11.5).font_semibold().text_color(t.dim).child(texte);
    const barre = (ratio, couleur, h = 6) => h_flex().h(h).w_full().rounded(h / 2).overflow_hidden().bg(t.raised)
      .child(div().h_full().flex_none().w(`${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(2)}%`).bg(couleur));

    const ligneAgent = (a) => {
      const couleur = COULEUR_TIER[tierDe(a.type)];
      const ctxR = a.ctx / fenetre(a.modele);
      const modele = a.effort ? `${nomModele(a.modele)} · ${a.effort}` : nomModele(a.modele || a.meta?.model || "");
      const inactif = a.enCours && a.vu && maintenant - a.vu > 5 * 60000;
      return v_flex().id(`sa-${a.id}`).flex_none().mx(6).px(8).py(6).gap(4).rounded(7).hover((s) => s.bg(t.hover))
        .tooltip(`${a.description}\n${a.type || "agent"}${a.fond ? " · en arrière-plan" : ""}`)
        .child(h_flex().gap(8).items_center()
          .child(a.enCours
            ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(couleur).spin(900)
            : div().size(10).flex_none().rounded(5).bg(couleur))
          .child(div().flex_1().min_w(0).truncate().child(a.description))
          .when(a.tour > 1, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`tour ${a.tour}`)))
          .child(div().flex_none().text_size(12).text_color(t.muted).child(a.debut ? duree(fin(a) - a.debut) : "")))
        .child(h_flex().pl(18).gap(8).items_center().text_size(11.5).text_color(t.muted)
          .child(div().flex_none().child(modele))
          .child(div().flex_none().text_color(t.dim).child(`ctx ${Math.round(ctxR * 100)} %`))
          .child(div().flex_1())
          .child(div().flex_none().child(`${tokens(a.tokens)} tok`))
          .child(div().flex_none().w(48).text_right().child(`≈${dollars(a.cout)}`)))
        .child(div().pl(18).child(barre(ctxR, ctxR > 0.8 ? t.ansi1 : t.dim, 3)))
        .when(Boolean(a.pas), (e) => e.child(h_flex().pl(18).gap(8).items_center().text_size(11.5)
          .child(div().w(90).flex_none().child(barre(a.pas.total ? a.pas.done / a.pas.total : 0, a.enCours ? couleur : FINI, 5)))
          .child(div().flex_none().text_color(t.muted).child(a.pas.total ? `${a.pas.done}/${a.pas.total}` : `${a.pas.done}`))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(a.pas.note ?? ""))))
        .when(inactif, (e) => e.child(div().pl(18).text_size(11).text_color(t.dim).child(`Rien écrit depuis ${duree(maintenant - a.vu)}`)));
    };

    const lignePrevue = (p) => {
      const couleur = COULEUR_TIER[p.tier || "other"];
      const m = MODELE_TIER[p.tier];
      return h_flex().id(`sp-${p.n}`).h(28).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
        .child(div().size(10).flex_none().rounded(5).border_1().border_color(couleur))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(`${p.n}.`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(p.title))
        .when(p.after.length > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`après ${p.after.join(", ")}`)))
        .when(Boolean(m), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`${m[0]} · ${m[1]}`)));
    };

    const out = [];
    // Le flow savvy : titre, barre, phase.
    if (f) {
      const r = f.isFinished ? 1 : f.total ? f.done / f.total : 0;
      out.push(v_flex().flex_none().mx(14).mb(4).gap(8)
        .child(h_flex().gap(8).items_center()
          .child(div().size(8).flex_none().rounded(4).bg(f.isFinished ? FINI : ACCENT))
          .child(div().flex_1().min_w(0).truncate().font_semibold().child(f.title))
          .child(div().flex_none().px(6).py(1).rounded(4).bg(f.isFinished ? FINI : ACCENT).text_size(11).font_semibold().text_color("#ffffff")
            .child(f.isFinished ? "Terminé" : ["plan", "design"].includes(f.phase) ? PHASE_MOT[f.phase]
              : `${PHASE_MOT[f.phase]} ${f.total ? `${f.done}/${f.total}` : `${enCours.length} en cours`}`)))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().child(barre(r, f.isFinished ? FINI : ACCENT, 8)))
          .child(div().flex_none().w(38).text_right().text_size(12).text_color(t.muted).child(`${Math.round(r * 100)} %`))));
    }
    // Le cumul.
    if (toutes.length) {
      out.push(h_flex().flex_none().mx(14).gap(14).text_size(12).text_color(t.muted)
        .child(div().child(`≈${dollars(cumul.cout)}`))
        .child(div().child(`${tokens(cumul.tokens)} tokens`))
        .child(div().child(duree(cumul.temps)))
        .child(div().flex_1())
        .child(div().text_color(t.dim).child(`${toutes.length} agent${toutes.length > 1 ? "s" : ""}`)));
    }
    if (!toutes.length && !prevus.length && !f) {
      if (!sbx.enCours.length && !sbx.fin.length) out.push(div().mx(14).h(24).text_size(12).text_color(this.erreur ? t.ansi1 : t.dim)
        .child(this.erreur ?? (this.lu ? "Aucun sous-agent pour l'instant" : "Lecture des sous-agents…")));
      return [...out, ...sbx.enCours, ...sbx.fin];
    }
    if (enCours.length) out.push(sousTitre(`En cours · ${enCours.length}`), ...enCours.map(ligneAgent));
    out.push(...sbx.enCours);
    if (prevus.length) out.push(sousTitre(`Prévus · ${prevus.length}`), ...prevus.map(lignePrevue));
    if (finis.length) {
      out.push(h_flex().id("sa-finis").px(14).pt(10).pb(4).gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.finisOuverts = !finisOuverts; cx.notify(); })
        .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(`Terminés · ${finis.length}`))
        .child(svg(`mods/files/chevron-${finisOuverts ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim)));
      if (finisOuverts) out.push(...finis.slice(0, 60).map(ligneAgent));
    }
    out.push(...sbx.fin);
    if (this.erreur) out.push(div().mx(14).pt(4).text_size(11).text_color(t.ansi1).child(this.erreur));
    return out;
  }
}

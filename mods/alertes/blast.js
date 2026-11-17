// Section Blast Radius du panneau Alertes (l'ancien panneau Blast) : la commande risquée que le mod Claude
// Blast Radius retient, ce qu'elle supprimerait ou écraserait, et Run / Cancel. La retenue reste le
// travail du plugin, dans Claude Code ; les boutons appuient pour vous sur les touches de son panneau
// (1 : Proceed, 2 : Cancel) avec `hc keys`, puis vérifient l'écran.
//
// Ce qui est montré : le résumé du plugin, lu sur l'écran du terminal (« Would … »), puis la liste
// détaillée, remesurée ici avec le même code que le plugin (classer.js), lancé sur la machine de l'agent.
// Repliés : « Measure a command » (l'effet d'une commande avant de la demander à un agent) et les
// réponses données ici. La veille (veille.js, lancée par l'en-tête) repère les retenues de tous les agents.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, agents, terminals, shared, setShared, run, panes, settings } from "herdr";
import { cible, session, sh, machineDe } from "./claude.js";
import { classify, resolveDir, measure, runSur } from "./classer.js";
import { retenues, regarder, marquer } from "./veille.js";
// Dates written by hand: the mod runtime ignores toLocale*'s locale and options ("11/16/2026, 02:56:15 AM").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const dayMonth = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

const HISTO = "blast-radius.historique";
export const JAUNE = "#d29922";

// Les appels Bash pas encore terminés, dans le journal principal et ceux des sous-agents récents :
// "U\t<ligne JSON>" pour un appel, "R\t<ids>" pour des résultats.
const EN_ATTENTE = String.raw`
f="$1"; d="$(dirname "$f")/$(basename "$f" .jsonl)/subagents"
for x in "$f" $(find "$d" -name 'agent-*.jsonl' -mmin -15 2>/dev/null); do
  [ -f "$x" ] || continue
  tail -c 400000 "$x" | LC_ALL=C awk '
    index($0, "\"type\":\"tool_use\",\"id\":") && index($0, "\"name\":\"Bash\"") && length($0) < 65536 { print "U\t" $0; next }
    index($0, "\"tool_use_id\":\"") { ids = ""; t = $0; while (match(t, /"tool_use_id":"[^"]*"/)) { ids = ids " " substr(t, RSTART + 15, RLENGTH - 16); t = substr(t, RSTART + RLENGTH) } print "R\t" ids }'
done
true`;

async function commandeComplete(S, debut) {
  const r = await sh(EN_ATTENTE, [S.file], S.machine, 20000);
  const appels = [], finis = new Set();
  for (const l of r.stdout.split("\n")) {
    if (l.startsWith("R\t")) { for (const id of l.slice(2).split(" ").filter(Boolean)) finis.add(id); continue; }
    if (!l.startsWith("U\t")) continue;
    let j = null;
    try { j = JSON.parse(l.slice(2)); } catch { continue; }
    for (const c of j?.message?.content ?? []) if (c?.type === "tool_use" && c.name === "Bash") appels.push({ id: c.id, commande: String(c.input?.command ?? "") });
  }
  const restants = appels.filter((a) => !finis.has(a.id) && classify(a.commande));
  return (restants.reverse().find((a) => a.commande.replace(/\s+/g, " ").startsWith(debut)) ?? restants[0])?.commande ?? null;
}

export class SectionBlast {
  constructor() {
    this.mesures = {};      // adresse → { commande, rapport, erreur, cle }
    this.essai = null;      // { commande, rapport, erreur }
    this.note = null;
    this.occupe = false;
    this.saisie = null;
    this.ouvert = { mesurer: false, reponses: false };
    this.champ = InputState.new({ placeholder: "e.g. git reset --hard" });
    this.champ.on("submit", (_e, cx) => this.mesurer(cx));
    this.champ.on("focus", (_e, cx) => { this.saisie = "essai"; cx.notify(); });
    this.champ.on("blur", (_e, cx) => { if (this.saisie === "essai") this.saisie = null; cx.notify(); });
  }

  nombre() { return Object.keys(retenues()).length; }

  // Sans la veille (autre disposition) : l'agent suivi est regardé toutes les 3 s pendant qu'il travaille.
  // Le panneau appelle ceci seulement quand il est à l'écran.
  surveiller(cx) {
    const a = cible();
    if (!a || this.regarde) return;
    const k = terminals().find((x) => x.address === a);
    const statut = typeof k?.status === "string" ? k.status : k?.report?.state;
    if (statut && statut !== "working" && !retenues()[a]) return;
    this.regarde = true;
    cx.spawn(async (cx) => {
      try { marquer(a, await regarder(a)); } finally { this.regarde = false; cx.notify(); }
    });
  }

  // La liste détaillée d'une retenue, remesurée sur la machine de l'agent.
  detailler(addr, r, cx) {
    const cle = `${r.label}|${r.commande}`;
    if (this.mesures[addr]?.cle === cle) return;
    this.mesures[addr] = { cle, enCours: true };
    cx.spawn(async (cx) => {
      const m = { cle };
      try {
        const S = await session(addr);
        if (S.erreur) throw new Error(S.erreur);
        let commande = r.commande;
        if (commande.endsWith("…") || !classify(commande)) commande = (await commandeComplete(S, commande.replace(/…$/, "").replace(/\s+/g, " "))) ?? commande;
        m.commande = commande;
        const risque = classify(commande);
        if (risque) {
          const exec = runSur(S.machine);
          const cwd = risque.dir ? await resolveDir(exec, S.cwd, risque.dir) : S.cwd;
          m.rapport = cwd === null
            ? { summary: `${risque.label} in ${risque.dir}`, lines: [], note: `Folder ${risque.dir} not found: can't measure.` }
            : await measure(exec, risque, cwd);
          m.dossier = cwd;
        }
      } catch (e) { m.erreur = String(e?.message ?? e).slice(0, 200); }
      if (this.mesures[addr]?.cle === cle) this.mesures[addr] = m;
      cx.notify();
    });
  }

  repondre(addr, choix, cx) {
    if (this.occupe) return;
    const r = retenues()[addr];
    if (!r) return;
    this.occupe = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Encore là ? (on a pu répondre dans le terminal entre-temps)
        const avant = await regarder(addr);
        if (!avant) { marquer(addr, null); this.note = "Already answered: the command is no longer held."; return; }
        const k = await hc(["keys", addr, choix === "proceed" ? "1" : "2"]);
        if (k.code !== 0) throw new Error((k.stderr || "hc keys failed").trim().slice(0, 160));
        let encore = avant;
        for (let i = 0; i < 6 && encore; i += 1) { await exec("sleep", ["0.5"]).catch(() => null); encore = await regarder(addr); }
        if (encore) { this.note = "The plugin's prompt didn't react: answer in the terminal (1 or 2)."; return; }
        marquer(addr, null);
        const h = [{ at: Date.now(), addr, commande: this.mesures[addr]?.commande ?? r.commande, effet: r.effet, choix }, ...((shared(HISTO) ?? []))].slice(0, 20);
        setShared(HISTO, h);
        this.note = choix === "proceed" ? "Ran: the plugin let the command through." : "Canceled: Claude got the refusal and the reason.";
      } catch (e) {
        this.note = String(e?.message ?? e).slice(0, 200);
      } finally {
        this.occupe = false;
        cx.notify();
      }
    });
  }

  mesurer(cx) {
    const commande = this.champ.value().trim();
    if (!commande) return;
    const addr = cible();
    this.essai = { commande, enCours: true };
    cx.notify();
    cx.spawn(async (cx) => {
      const e = { commande };
      try {
        const risque = classify(commande);
        if (!risque) e.rapport = { summary: "nothing: Blast Radius would let this command through", lines: [], note: "Only rm -r/-f, git reset --hard, git checkout/restore ., git clean, git push --force and migrations are held." };
        else {
          let machine = machineDe(addr), base = null;
          if (addr) { const S = await session(addr); if (!S.erreur) { machine = S.machine; base = S.cwd; } }
          base = base || panes().find((p) => p.terminal === addr)?.cwd || null;
          if (!base) throw new Error("No folder to measure in: select a terminal.");
          const exec = runSur(machine);
          const cwd = risque.dir ? await resolveDir(exec, base, risque.dir) : base;
          e.dossier = cwd ?? base;
          e.rapport = cwd === null ? { summary: `${risque.label} in ${risque.dir}`, lines: [], note: `Folder ${risque.dir} not found.` } : await measure(exec, risque, cwd);
          e.label = risque.label;
        }
      } catch (err) { e.erreur = String(err?.message ?? err).slice(0, 200); }
      this.essai = e;
      cx.notify();
    });
  }

  // Les lignes de la section, sous son titre.
  elements(t, cx) {
    const ici = cible();
    const liste = Object.entries(retenues()).sort(([a], [b]) => (a === ici ? -1 : b === ici ? 1 : 0));
    for (const [addr, r] of liste) this.detailler(addr, r, cx);
    const mono = settings().font_family ?? "JetBrains Mono";
    const pret = !this.occupe;

    const bouton = (id, texte, action, style) => div().id(id).h(30).px(12).flex().items_center().rounded(7).text_size(12.5)
      .when(style === "danger", (e) => e.border_1().border_color(t.ansi1).text_color(pret ? t.ansi1 : t.dim))
      .when(style === "principal", (e) => e.bg(pret ? t.solid : t.raised).text_color(pret ? t.solid_foreground : t.dim))
      .when(!style, (e) => e.border_1().border_color(t.border).text_color(t.muted))
      .when(pret, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => action(cx)))
      .child(texte);
    const rapport = (rp, id) => v_flex().gap(3)
      .children((rp.lines ?? []).map((l, i) => div().id(`${id}-l${i}`).truncate().font_family(mono).text_size(11.5).text_color(t.muted).child(l)))
      .when(Boolean(rp.more), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`+ ${rp.more} more`)))
      .when(Boolean(rp.note), (e) => e.child(div().pt(4).text_size(11.5).text_color(t.dim).child(rp.note)));
    const repli = (cle, texte) => h_flex().id(`br-${cle}`).px(14).pt(8).pb(4).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.ouvert[cle] = !this.ouvert[cle]; cx.notify(); })
      .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(texte))
      .child(svg(`mods/files/chevron-${this.ouvert[cle] ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim));

    const carte = (addr, r) => {
      const a = agents().find((x) => x.address === addr);
      const m = this.mesures[addr] ?? {};
      const lui = addr === ici;
      return v_flex().id(`br-r-${addr}`).flex_none().mx(10).mb(8).p(12).gap(8).rounded(8).border_1().border_color(JAUNE)
        .child(h_flex().gap(8).items_center()
          .child(div().text_color(JAUNE).font_semibold().child(`⚠ ${r.label || "risky command"}`))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child(lui ? "this agent" : (a?.tab_name || a?.space_name || terminals().find((x) => x.address === addr)?.labels?.where || addr))))
        .child(div().id(`br-c-${addr}`).font_family(mono).text_size(12).p(8).rounded(6).bg(t.raised).child(m.commande ?? r.commande))
        .child(h_flex().gap(6).items_start()
          .child(div().w(70).flex_none().text_size(12).text_color(t.muted).child("Effect"))
          .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.ansi1).child(r.effet || m.rapport?.summary || "…")))
        .when(Boolean(m.rapport), (e) => e.child(rapport(m.rapport, `br-d-${addr}`)))
        .when(Boolean(m.erreur), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`Details unavailable: ${m.erreur}`)))
        .when(m.enCours === true, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("Measuring…")))
        .child(h_flex().gap(8).pt(4).items_center()
          .child(bouton(`br-p-${addr}`, "Run", (cx) => this.repondre(addr, "proceed", cx), "danger"))
          .child(bouton(`br-x-${addr}`, "Cancel", (cx) => this.repondre(addr, "cancel", cx), "principal"))
          .child(div().flex_1())
          .when(!lui, (e) => e.child(bouton(`br-g-${addr}`, "Go to agent", () => run("agent.focus", { terminal: addr }))))
          .when(lui, (e) => e.child(div().text_size(11).text_color(t.dim).child("Claude is waiting for you"))));
    };

    const histo = shared(HISTO) ?? [];
    const essai = this.essai;
    const out = liste.map(([addr, r]) => carte(addr, r));
    if (!liste.length) out.push(div().mx(14).h(24).text_size(12).text_color(t.dim).child("No held commands"));
    if (this.note) out.push(div().mx(14).pb(4).text_size(11.5).text_color(t.dim).child(this.note));

    out.push(repli("mesurer", "Measure a command"));
    if (this.ouvert.mesurer) {
      out.push(h_flex().flex_none().mx(14).gap(8)
        .child(div().id("br-essai").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8).border_1()
          .border_color(this.saisie === "essai" ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.champ).h_full().font_family(mono).text_size(12).text_color(t.foreground)))
        .child(bouton("br-mesurer", "Measure", (cx) => this.mesurer(cx))));
      if (essai) out.push(v_flex().flex_none().mx(14).mt(8).gap(6)
        .when(essai.enCours === true, (x) => x.child(div().text_size(12).text_color(t.dim).child("Measuring…")))
        .when(Boolean(essai.rapport), (x) => x
          .child(div().text_size(12.5).font_semibold().text_color(essai.label ? t.ansi1 : t.muted).child(essai.rapport.summary))
          .when(Boolean(essai.dossier), (y) => y.child(div().text_size(11).text_color(t.dim).child(`in ${essai.dossier}`)))
          .child(rapport(essai.rapport, "br-essai")))
        .when(Boolean(essai.erreur), (x) => x.child(div().text_size(12).text_color(t.ansi1).child(essai.erreur))));
    }
    if (histo.length) {
      out.push(repli("reponses", `Answered here · ${histo.length}`));
      if (this.ouvert.reponses) out.push(...histo.slice(0, 10).map((h, i) => h_flex().id(`br-h-${i}`).h(24).flex_none().mx(6).px(8).gap(8).items_center()
        .tooltip(`${h.commande}${h.effet ? `\n${h.effet}` : ""}`)
        .child(div().w(66).flex_none().text_size(11).text_color(h.choix === "proceed" ? t.ansi1 : t.muted).child(h.choix === "proceed" ? "ran" : "canceled"))
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(11.5).child(h.commande))
        .child(div().text_size(11).text_color(t.dim).child(hhmm(new Date(h.at))))));
    }
    return out;
  }
}

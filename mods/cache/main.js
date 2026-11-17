// Cache : le cache de prompt de la session Claude Code suivie (terminal actif, ou agent d'un volet de chat),
// comme la ligne et la carte /cache-tax du mod Claude cache-tax : chaud ou froid, depuis quand, ce que coûte
// un envoi à froid (la réécriture du contexte) face à un tour à chaud, les réécritures déjà payées, et
// la fenêtre keepwarm. Un popup (dialogue), ouvert par « Details » dans la section Cache du panneau
// Session, qui a les boutons keepwarm (90m, 6h, Stop) et garde (Warn only, Block).
//
// La lecture (journal et store du plugin) est dans cache-etat.js, commun avec Session. Garder au chaud et
// le garde restent le travail du plugin cache-tax, dans Claude Code.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { cible, session, affiche, nomModele, tokens, dollars, milliers, dureeCourte } from "./claude.js";
import { EtatCache, ORANGE, VERT } from "./cache-etat.js";

const ID = "cache";
// "17 Nov, 10:36" (le moteur des mods ignore la locale et les options de toLocaleString : écrit à la main).
const MOIS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const deux = (n) => String(n).padStart(2, "0");
const quand = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MOIS[d.getMonth()]}, ${deux(d.getHours())}:${deux(d.getMinutes())}`; };

export default class Cache extends View {
  init(_props, cx) {
    this.addr = null;
    this.etat = new EtatCache();
    this.note = null;
    this.erreur = null;
    this.suivre(cx);
    cx.timer.every(2000, (cx) => this.tic(cx));
    // Le compte à rebours avance à la minute.
    cx.timer.every(30000, (cx) => { if (affiche(ID)) cx.notify(); });
  }

  suivre(cx) {
    const a = cible();
    if (!a || a === this.addr) return;
    this.addr = a;
    this.note = null;
    this.erreur = null;
    this.etat.viser(null);
    this.dernierTour = 0;
    this.lire(cx);
  }

  tic(cx) {
    if (affiche(ID) && Date.now() - (this.dernierTour ?? 0) >= 10000) this.lire(cx);
  }

  // La session est résolue à chaque tour : un /clear ou un nouveau claude dans le terminal fait repartir la lecture.
  lire(cx) {
    if (this.occupe || !this.addr) return;
    const addr = this.addr;
    this.occupe = true;
    this.dernierTour = Date.now();
    cx.spawn(async (cx) => {
      try {
        const s = await session(addr);
        if (this.addr !== addr) return;
        if (s.erreur) { this.erreur = s.erreur; this.etat.viser(null); return; }
        this.erreur = null;
        this.etat.viser(s);
        await this.etat.lire();
      } catch (e) {
        if (this.addr === addr) this.erreur = String(e).slice(0, 200);
      } finally {
        this.occupe = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    this.suivre(cx);
    const t = theme(), maintenant = Date.now();
    const E = this.etat, S = E.sess, d = E.der;
    const c = E.calcul(maintenant);
    const { etat, deadline, arme, garde, toujours, froidUsd, chaudUsd, pings, paye, alerte } = c;

    const titre = (texte) => div().px(14).pt(14).pb(8).text_size(12).font_semibold().text_color(t.muted).child(texte);
    const sep = () => div().h(1).flex_none().mx(14).mt(12).bg(t.border);
    const info = (cle, val, ton) => h_flex().id(`i-${cle}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
      .child(div().w(118).flex_none().text_size(12).text_color(t.muted).child(cle))
      .child(div().flex_1().min_w(0).truncate().text_color(ton ?? t.foreground).child(val));

    const couleur = c.couleur ?? t.dim;
    const motEtat = c.mot;
    const sousEtat = c.sousEtat;
    const erreur = this.erreur || E.erreur;
    const vide = erreur || (this.addr ? "Reading the session…" : "Select a Claude Code terminal.");
    // Garder au chaud, en clair, avec les prix de cette session.
    const aChaud = chaudUsd != null ? `≈ ${dollars(chaudUsd)}` : "the price of a warm turn";
    const aFroid = froidUsd != null ? `≈ ${dollars(froidUsd)}` : "much more";
    const principe = `The cache keeps the conversation for ${c.ttlMot}. After that, the next message rewrites all of it: ${aFroid} here, versus ${aChaud} while warm. `
      + `During a break, keepwarm re-reads it every 50 minutes without adding anything (${aChaud} per ping), which keeps it warm until the window ends. `
      + "Claude Code must stay open; a cache that is already cold is not re-read.";
    const texte = (t2) => div().mx(14).text_size(12).line_height("18px").text_color(t.muted).child(t2);

    const overlay = Boolean(props()?.overlay);
    const lieu = `${S?.machine ?? "This computer"} · ${this.addr?.split("/").pop() ?? ""}`;
    // En popup, Herdr dessine le cadre (bordure arrondie de 6 px, ombre) sans couper ce qu'il contient : le fond
    // est arrondi à 5 px (le rayon intérieur du cadre) et sans bordure à soi ; en panneau, son propre cadre.
    return v_flex().id("cache").size_full().min_h(0).when(overlay, (e) => e.h(620)).rounded(overlay ? 5 : 10).overflow_hidden().bg(t.background).when(!overlay, (e) => e.border_1().border_color(t.border))
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Cache"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(this.addr ? lieu : ""))
        .when(overlay, (e) => e.child(div().id("fermer").text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => closeOverlay(props().overlay)).child("Esc"))))
      .when(!S || !E.lu, (el) => el.child(div().p(14).text_size(12).text_color(t.dim).child(vide)))
      .when(Boolean(S) && E.lu, (el) => el
        .child(div().flex_1().min_h(0).relative()
          .child(v_flex().id("cache-liste").absolute().inset_0().overflow_y_scroll().pb(10)
            // L'état
            .child(v_flex().flex_none().mx(14).mt(14).gap(6)
              .child(h_flex().gap(10).items_center()
                .child(div().size(10).flex_none().rounded(5).bg(couleur))
                .child(div().text_size(16).font_semibold().child(motEtat))
                .child(div().flex_1())
                .child(div().text_size(11).text_color(t.dim).child(`cache ${d?.ttl === "5m" ? "5m" : "1h"}`)))
              .child(div().text_size(12).text_color(t.muted).child(sousEtat)))
            .when(alerte, (x) => x.child(div().mx(14).mt(12).p(10).rounded(8).border_1().border_color(ORANGE).text_size(12)
              .child(garde === "refuse"
                ? `cache-tax will block the next message once: it would rewrite up to ${milliers(E.ctx)} tokens (≈ ${dollars(froidUsd)}). Send it again to pay, or /clear and start over from a note.`
                : `The next message will rewrite up to ${milliers(E.ctx)} tokens (≈ ${dollars(froidUsd)}). The cache-tax guard only warns.`)))
            .child(sep())
            // Les chiffres
            .child(titre("Prices"))
            .child(info("Model", d ? nomModele(d.modele) : "—"))
            .child(info("Context", `${milliers(E.ctx)} tokens`))
            .child(info("Cold send", `≈ ${dollars(froidUsd)} (rewrite)`, etat === "froid" ? ORANGE : null))
            .child(info("Warm turn", `≈ ${dollars(chaudUsd)} (read)`))
            .when(pings != null, (x) => x.child(info("Break-even", `${pings} pings (read) = 1 rewrite`)))
            .child(sep())
            // Keepwarm (le plugin)
            .child(titre("Keep warm"))
            .child(texte(principe).mb(10))
            .when(E.plugin === false, (x) => x.child(div().mx(14).mb(6).text_size(12).text_color(t.dim)
              .child(`The cache-tax plugin is not active on ${S.machine ?? "this computer"}: the buttons in Session would have no effect.`)))
            .child(info("Window", arme ? `active, ${dureeCourte(deadline - maintenant)} left` : "stopped", arme ? VERT : t.muted))
            // « Always » (/keepwarm always) n'a plus de bouton ; montré tant qu'il est actif (Stop le coupe).
            .when(toujours, (x) => x.child(info("Always", "a 6h window at every session start")))
            .child(texte("In Session: 90m and 6h open a window for this session; Stop closes it (and turns off Always).").mt(6).text_color(t.dim))
            .child(info("Guard", garde === "refuse" ? "blocks once" : "warns only"))
            .child(texte(garde === "refuse"
              ? "Before a cold send of more than 50k tokens, cache-tax shows the price and blocks that first send; send it again to pay. Warn only / Block: in Session."
              : "Before a cold send of more than 50k tokens, cache-tax shows the price without blocking. Warn only / Block: in Session.").text_color(t.dim))
            .child(sep())
            // Les réécritures payées
            .child(titre(`Rewrites paid · ${E.manques.length}${E.manques.length ? ` · ≈ ${dollars(paye)}` : ""}`))
            .children(E.manques.slice().reverse().slice(0, 12).map((m, i) => h_flex().id(`m-${i}`).h(24).flex_none().mx(6).px(8).gap(8).items_center()
              .child(div().w(118).flex_none().text_size(12).text_color(t.muted)
                .child(quand(m.at)))
              .child(div().flex_1().text_size(12).child(`${tokens(m.tokens)} tokens`))
              .child(div().text_size(12).text_color(t.muted).child(`≈ ${dollars(m.usd)}`))))
            .when(!E.manques.length, (x) => x.child(div().mx(14).text_size(12).text_color(t.dim).child("None in the last 8 MB of the log."))))
          .child(Scrollbar.vertical("cache-liste").absolute().inset_0()))
        .when(Boolean(erreur), (x) => x.child(div().px(12).py(6).text_size(11).text_color(t.ansi1).child(erreur)))
        .when(Boolean(this.note), (x) => x.child(div().px(12).py(6).text_size(11).text_color(t.dim).child(this.note))));
  }
}

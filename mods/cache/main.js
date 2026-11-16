// Cache : le cache de prompt de la session Claude Code suivie (terminal actif, ou agent d'un volet de chat),
// comme la ligne et la carte /cache-tax du mod Claude cache-tax : chaud ou froid, depuis quand, ce que coûte
// un envoi à froid (la réécriture du contexte) face à un tour à chaud, les réécritures déjà payées, et
// la fenêtre keepwarm. Un popup (dialogue), ouvert par « Détails » dans la section Cache du panneau
// Session, qui a les boutons keepwarm (90 min, 6 h, Arrêter) et garde (Avertir seulement, Bloquer).
//
// La lecture (journal et store du plugin) est dans cache-etat.js, commun avec Session. Garder au chaud et
// le garde restent le travail du plugin cache-tax, dans Claude Code.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { cible, session, affiche, nomModele, tokens, dollars, milliers, dureeCourte } from "./claude.js";
import { EtatCache, ORANGE, VERT } from "./cache-etat.js";

const ID = "cache";

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
    const vide = erreur || (this.addr ? "Lecture de la session…" : "Sélectionnez un terminal Claude Code.");
    // Garder au chaud, en clair, avec les prix de cette session.
    const aChaud = chaudUsd != null ? `≈${dollars(chaudUsd)}` : "le prix d'un tour à chaud";
    const aFroid = froidUsd != null ? `≈${dollars(froidUsd)}` : "beaucoup plus";
    const principe = `Le cache garde la conversation ${c.ttlMot}. Après, le prochain message la réécrit en entier : ${aFroid} ici, contre ${aChaud} à chaud. `
      + `Pendant une pause, keepwarm la relit toutes les 50 min sans rien y ajouter (${aChaud} le ping), ce qui la garde au chaud jusqu'à la fin de la fenêtre. `
      + "Claude Code doit rester ouvert ; un cache déjà froid n'est pas relu.";
    const texte = (t2) => div().mx(14).text_size(12).line_height("18px").text_color(t.muted).child(t2);

    const overlay = Boolean(props()?.overlay);
    const lieu = `${S?.machine ?? "Ce serveur"} · ${this.addr?.split("/").pop() ?? ""}`;
    return v_flex().id("cache").size_full().min_h(0).when(overlay, (e) => e.h(620)).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
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
                .child(div().text_size(11).text_color(t.dim).child(`cache ${d?.ttl === "5m" ? "5 min" : "1 h"}`)))
              .child(div().text_size(12).text_color(t.muted).child(sousEtat)))
            .when(alerte, (x) => x.child(div().mx(14).mt(12).p(10).rounded(8).border_1().border_color(ORANGE).text_size(12)
              .child(garde === "refuse"
                ? `Le prochain message sera bloqué une fois par cache-tax : il réécrirait jusqu'à ${milliers(E.ctx)} tokens (≈${dollars(froidUsd)}). Renvoyez-le pour payer, ou /clear et repartez d'une note.`
                : `Le prochain message réécrira jusqu'à ${milliers(E.ctx)} tokens (≈${dollars(froidUsd)}). Le garde de cache-tax ne fait qu'avertir.`)))
            .child(sep())
            // Les chiffres
            .child(titre("Prix"))
            .child(info("Modèle", d ? nomModele(d.modele) : "—"))
            .child(info("Contexte", `${milliers(E.ctx)} tokens`))
            .child(info("Envoi à froid", `≈${dollars(froidUsd)} (réécriture)`, etat === "froid" ? ORANGE : null))
            .child(info("Tour à chaud", `≈${dollars(chaudUsd)} (lecture)`))
            .when(pings != null, (x) => x.child(info("Rentabilité", `${pings} pings (lecture) = 1 réécriture`)))
            .child(sep())
            // Keepwarm (le plugin)
            .child(titre("Garder au chaud"))
            .child(texte(principe).mb(10))
            .when(E.plugin === false, (x) => x.child(div().mx(14).mb(6).text_size(12).text_color(t.dim)
              .child(`Le plugin cache-tax n'est pas actif sur ${S.machine ?? "cette machine"} : les boutons de Session n'auraient pas d'effet.`)))
            .child(info("Fenêtre", arme ? `active, ${dureeCourte(deadline - maintenant)} restantes` : "arrêtée", arme ? VERT : t.muted))
            // « Toujours » (/keepwarm always) n'a plus de bouton ; montré tant qu'il est actif (Arrêter le coupe).
            .when(toujours, (x) => x.child(info("Toujours", "une fenêtre de 6 h à chaque début de session")))
            .child(texte("Dans Session : 90 min et 6 h ouvrent une fenêtre pour cette session ; Arrêter la ferme (et coupe « toujours »).").mt(6).text_color(t.dim))
            .child(info("Garde", garde === "refuse" ? "bloque une fois" : "avertit seulement"))
            .child(texte(garde === "refuse"
              ? "Avant un envoi à froid de plus de 50k tokens, cache-tax affiche le prix et bloque ce premier envoi ; renvoyez-le pour payer. Avertir seulement / Bloquer : dans Session."
              : "Avant un envoi à froid de plus de 50k tokens, cache-tax affiche le prix, sans bloquer. Avertir seulement / Bloquer : dans Session.").text_color(t.dim))
            .child(sep())
            // Les réécritures payées
            .child(titre(`Réécritures payées · ${E.manques.length}${E.manques.length ? ` · ≈${dollars(paye)}` : ""}`))
            .children(E.manques.slice().reverse().slice(0, 12).map((m, i) => h_flex().id(`m-${i}`).h(24).flex_none().mx(6).px(8).gap(8).items_center()
              .child(div().w(118).flex_none().text_size(12).text_color(t.muted)
                .child(new Date(m.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })))
              .child(div().flex_1().text_size(12).child(`${tokens(m.tokens)} tokens`))
              .child(div().text_size(12).text_color(t.muted).child(`≈${dollars(m.usd)}`))))
            .when(!E.manques.length, (x) => x.child(div().mx(14).text_size(12).text_color(t.dim).child("Aucune dans les 8 derniers Mo du journal."))))
          .child(Scrollbar.vertical("cache-liste").absolute().inset_0()))
        .when(Boolean(erreur), (x) => x.child(div().px(12).py(6).text_size(11).text_color(t.ansi1).child(erreur)))
        .when(Boolean(this.note), (x) => x.child(div().px(12).py(6).text_size(11).text_color(t.dim).child(this.note))));
  }
}

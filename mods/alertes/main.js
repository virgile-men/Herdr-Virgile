// Alertes : Blast Radius, Règles et Notifications réunis dans un panneau. Les deux premières sections
// ne prennent qu'une ligne quand elles n'ont rien ; elles grandissent quand un agent Claude a une commande
// retenue (blast.js) ou que reflect-mod propose une règle (regles.js). Notifications : le journal de ce
// que Herdr signale (un agent attend votre réponse, un agent a fini pendant que vous ne regardiez pas),
// plus les retenues et les règles proposées, tenu par la veille de l'en-tête (tabs-vault/veille-notifs.js)
// puisque Herdr n'en garde pas. Un clic sur une notification va à l'agent.
//
// La veille de l'en-tête ouvre ce panneau quand l'agent suivi a une commande retenue, et son bouton
// compte ce qui attend une décision (« Alerts · 2 »), ou montre « Alerts • » s'il y a du nouveau.
// Ne lit rien tant que le panneau est caché.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, run, shared, setShared } from "herdr";
import { affiche } from "./claude.js";
import { SectionBlast, JAUNE } from "./blast.js";
import { SectionRegles } from "./regles.js";
import { journal, titreNotif, JOURNAL, VU } from "./notifs.js";
// Dates written by hand: the mod runtime ignores toLocale*'s locale and options ("11/16/2026, 02:56:15 AM").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const dayMonth = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

const ID = "alertes";
const MONTRES = 40;

// « just now », « 5 min ago », « 2h ago », puis la date (« 17 Nov, 14:05 »).
const ilYa = (ms, at) => {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  const d = new Date(at);
  return `${dayMonth(d)}, ${hhmm(d)}`;
};

export default class Alertes extends View {
  init(_props, cx) {
    this.blast = new SectionBlast();
    this.regles = new SectionRegles();
    this.visible = false;
    this.vuAvant = Number(shared(VU)) || 0;   // ce qui était vu avant que le panneau s'affiche : le reste est en gras
    this.quand = { blast: 0, regles: 0, heure: 0 };
    cx.timer.every(1000, (cx) => this.tic(cx));
  }

  tic(cx) {
    if (!affiche(ID)) { this.visible = false; return; }
    const m = Date.now(), neuf = !this.visible;
    this.visible = true;
    if (neuf) this.vuAvant = Number(shared(VU)) || 0;
    this.regles.suivre(cx);
    if (neuf || m - this.quand.blast >= 3000) { this.quand.blast = m; this.blast.surveiller(cx); }
    if (neuf || m - this.quand.regles >= 15000) { this.quand.regles = m; this.regles.charger(cx); }
    // À l'écran, tout est vu (l'en-tête perd son point).
    const l = journal();
    if (l.length && l[0].at > (Number(shared(VU)) || 0)) setShared(VU, l[0].at);
    if (neuf || m - this.quand.heure >= 30000) { this.quand.heure = m; cx.notify(); }
  }

  render(cx) {
    this.regles.suivre(cx);
    const t = theme(), maintenant = Date.now();
    const nBlast = this.blast.nombre(), nRegles = this.regles.attente().length;
    const pause = this.regles.enPause();
    const notifs = journal().slice(0, MONTRES);
    const COULEUR = { attend: t.blocked ?? t.ansi1, fini: t.done ?? t.ansi2, blast: JAUNE, regle: "#8f8cf4" };

    const sep = () => div().h(1).flex_none().mx(14).mt(10).bg(t.border);
    const pastille = (texte, couleur) => div().px(5).py(1).rounded(4).border_1().border_color(couleur ?? t.border).text_size(10)
      .text_color(couleur ?? t.muted).child(texte);
    const lien = (id, texte, action, couleur) => div().id(id).pt(6).text_size(11).text_color(couleur ?? t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx)).child(texte);
    const titre = (texte, badge, droite) => h_flex().flex_none().items_center().pr(14)
      .child(h_flex().flex_1().px(14).pt(14).pb(8).gap(8).items_center()
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(texte))
        .when(Boolean(badge), (e) => e.child(badge)))
      .when(Boolean(droite), (e) => e.child(droite));

    const ligneNotif = (n) => {
      const neuve = n.at > this.vuAvant, titreN = titreNotif(n);
      return h_flex().id(`n-${n.id}`).flex_none().mx(6).px(8).py(5).gap(8).items_start().rounded(7)
        .tooltip(n.corps ? `${titreN}\n${n.corps}` : titreN)
        .when(Boolean(n.addr), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => run("agent.focus", { terminal: n.addr })))
        .child(div().size(8).mt(5).flex_none().rounded(4).bg(COULEUR[n.type] ?? t.accent))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(12.5).text_color(t.foreground).when(neuve, (e) => e.font_semibold()).child(titreN))
          .when(Boolean(n.corps), (e) => e.child(div().truncate().text_size(11.5).text_color(t.muted).child(n.corps))))
        .child(div().flex_none().pt(1).text_size(11).text_color(t.dim).child(ilYa(maintenant - n.at, n.at)));
    };

    return v_flex().id("alertes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("alertes-liste").absolute().inset_0().overflow_y_scroll().pb(10)
          // Blast Radius
          .child(titre("Blast Radius", nBlast ? pastille(`${nBlast} held`, JAUNE) : null))
          .children(this.blast.elements(t, cx))
          .child(sep())
          // Règles
          .child(titre("Rules", nRegles ? pastille(`${nRegles} pending`, t.accent) : null,
            this.regles.store ? lien("pause", pause ? "Paused · resume" : "Pause", (cx) => this.regles.pause(cx), pause ? t.ansi3 : null) : null))
          .children(this.regles.elements(t, cx))
          .child(sep())
          // Notifications
          .child(titre("Notifications", null,
            notifs.length ? lien("effacer", "Clear all", (cx) => { setShared(JOURNAL, []); cx.notify(); }) : null))
          .children(notifs.map(ligneNotif))
          .when(!notifs.length, (e) => e.child(div().mx(14).text_size(12).text_color(t.dim)
            .child("No notifications. They appear here when an agent needs your answer, an agent finishes while you're not looking, a command is held or a rule is suggested."))))
        .child(Scrollbar.vertical("alertes-liste").absolute().inset_0()));
  }
}

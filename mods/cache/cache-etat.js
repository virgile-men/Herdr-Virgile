// L'état du cache de prompt d'une session Claude Code, lu de l'extérieur : commun au panneau Cache et au
// résumé « Cache » du panneau Session. Source : ~/herdr-panneaux/panneaux/_commun/cache-etat.js, copiée
// dans ces deux mods par vault-setup.py (un mod ne peut rien importer hors de son dossier).
//
// Lu : les réponses du journal (heure, modèle, tokens, durée de cache demandée « 1h » ou « 5m ») et le
// store du plugin cache-tax (~/.claude/plugins/store/cache-tax_*.json : deadline:<session>, always, guard).
// Garder au chaud et le garde restent le travail du plugin, dans Claude Code. Ses pings ne s'écrivent pas
// dans le journal : fenêtre active, l'état « chaud » au-delà de la durée du cache est une estimation.
import { sh, AGREGE, lireAgrege, prix, connu, dureeCourte } from "./claude.js";

export const GROS = 50000;            // en dessous, cache-tax laisse passer un envoi à froid
const FENETRE_LUE = 8000000;          // au premier passage, les 8 derniers Mo du journal
export const ORANGE = "#d97757", VERT = "#3fb950";

// Le store du plugin et s'il est actif sur cette machine.
const STORE = String.raw`
on=0; grep -q '"cache-tax@[^"]*": *true' "$HOME/.claude/settings.json" 2>/dev/null && on=1
echo "plugin $on"
for f in "$HOME"/.claude/plugins/store/cache-tax_*.json; do [ -f "$f" ] && { tr -d '\n' < "$f"; echo; }; done
true`;
const LECTURE = AGREGE + `\nagrege "$1" "$2" "$3" "$4"`;

export class EtatCache {
  constructor() {
    this.gen = 0;
    this.repart(null);
  }

  // Une autre session (ou aucune) : tout est relu.
  repart(S) {
    this.gen += 1;
    this.sess = S ?? null;
    this.lu = false;          // au moins une lecture faite
    this.erreur = null;
    this.fin = null;          // octet lu du journal
    this.dernier = "";
    this.der = null;          // dernière réponse : { at, modele, ttl, u }
    this.ctx = 0;
    this.compacte = 0;        // heure du dernier compactage
    this.manques = [];        // réécritures payées : { at, tokens, usd }
    this.store = null;
    this.plugin = null;
    this.dernierTour = 0;
  }

  // La session à lire, telle que résolue (claude.js session()). La même (id, machine, journal) : on garde
  // ce qui est lu ; une autre (/clear, un nouveau claude dans le terminal) : on repart.
  viser(S) {
    const cle = (s) => (s ? `${s.machine ?? ""}|${s.id}|${s.file}` : "");
    if (cle(S) === cle(this.sess)) { if (S) this.sess = S; return; }
    this.repart(S);
  }

  async lire() {
    const S = this.sess, gen = this.gen;
    if (!S?.file) return;
    this.dernierTour = Date.now();
    let depuis = this.fin, saut = 0;
    if (depuis === null) { depuis = Math.max(0, S.size - FENETRE_LUE); saut = depuis > 0 ? 1 : 0; }
    const [r, st] = await Promise.all([
      sh(LECTURE, [S.file, String(depuis), this.dernier, String(saut)], S.machine, 30000),
      sh(STORE, [], S.machine, 15000),
    ]);
    if (gen !== this.gen) return;
    this.absorber(lireAgrege(r.stdout));
    const lignes = st.stdout.split("\n");
    this.plugin = lignes[0] === "plugin 1";
    this.store = {};
    for (const l of lignes.slice(1)) { try { Object.assign(this.store, JSON.parse(l)); } catch {} }
    this.erreur = r.code === 0 ? null : (r.stderr || "").trim().slice(0, 200) || null;
    this.lu = true;
  }

  // Chaque réponse du modèle : l'heure du dernier envoi, le contexte, et une réécriture quand une
  // réponse écrit au moins la moitié de ce que le contexte faisait déjà (le cache était froid).
  absorber(g) {
    if (!g.manquant) { this.fin = g.fin; this.dernier = g.dernier; }
    const evenements = [...g.reponses.map((x) => ({ k: "r", at: x.at, x })), ...g.compacts.map((at) => ({ k: "c", at }))]
      .sort((a, b) => a.at - b.at);
    for (const ev of evenements) {
      if (ev.k === "c") { this.compacte = ev.at; this.ctx = 0; continue; }
      const { x } = ev;
      if (!x.modele || x.modele.startsWith("<")) continue; // réponses synthétiques
      const u = x.u;
      const avant = this.ctx;
      const ctx = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens;
      if (avant > 20000 && u.cache_creation_input_tokens >= 0.5 * avant) {
        const [entree, , , ecrit1h] = prix(x.modele);
        const tarif = x.ttl === "5m" ? entree * 1.25 : ecrit1h;
        this.manques.push({ at: x.at, tokens: u.cache_creation_input_tokens, usd: u.cache_creation_input_tokens * tarif / 1e6 });
      }
      this.ctx = ctx;
      this.der = { at: x.at, modele: x.modele, ttl: x.ttl, u };
    }
    if (this.manques.length > 50) this.manques = this.manques.slice(-50);
  }

  // Ce que les deux vues affichent.
  calcul(maintenant = Date.now()) {
    const S = this.sess, d = this.der, st = this.store ?? {};
    const ttl = d?.ttl === "5m" ? 5 * 60000 : 60 * 60000;
    const compacteApres = Boolean(d) && this.compacte > d.at;
    const deadline = S ? Number(st[`deadline:${S.id}`]) || 0 : 0;
    const arme = deadline > maintenant;
    const garde = st.guard === "warn" ? "warn" : "refuse";
    const toujours = st.always === true;
    const ecoule = d ? maintenant - d.at : 0;
    const etat = !d || compacteApres ? "inconnu" : ecoule < ttl ? "chaud" : arme ? "garde" : "froid";
    const [pEntree, , pLu, pEcrit1h] = prix(d?.modele);
    const pEcrit = d?.ttl === "5m" ? pEntree * 1.25 : pEcrit1h;
    const k = connu(d?.modele);
    return {
      etat, ttl, ecoule, deadline, arme, garde, toujours, compacteApres,
      ctx: this.ctx,
      modele: d?.modele ?? null,
      ttlMot: d?.ttl === "5m" ? "5 min" : "1 h",
      froidUsd: k ? this.ctx * pEcrit / 1e6 : null,
      chaudUsd: k ? this.ctx * pLu / 1e6 : null,
      pings: k && pLu > 0 ? Math.floor(pEcrit / pLu) : null,
      paye: this.manques.reduce((s, m) => s + (m.usd ?? 0), 0),
      alerte: etat === "froid" && this.ctx >= GROS && this.plugin === true,
      couleur: { chaud: VERT, garde: VERT, froid: ORANGE, inconnu: null }[etat],
      mot: { chaud: "Chaud", garde: "Chaud (keepwarm)", froid: "Froid", inconnu: "Inconnu" }[etat],
      sousEtat: etat === "chaud" ? `froid dans ${dureeCourte(ttl - ecoule)}`
        : etat === "garde" ? `dernier envoi il y a ${dureeCourte(ecoule)} ; les pings de keepwarm le gardent au chaud`
        : etat === "froid" ? `froid depuis ${dureeCourte(ecoule - ttl)}`
        : compacteApres ? "compacté : en attente du premier tour" : "aucun envoi lu dans cette session",
    };
  }
}

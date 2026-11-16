// Vault : variables d'environnement par machine pour les terminaux Herdr.
//
// On choisit une machine, on saisit NOM et valeur (champ masqué). Le mod écrit
// `export NOM='valeur'` dans ~/.config/herdr-vault/env (0600) de cette machine
// et ajoute une fois au .bashrc / .zshrc une ligne qui charge ce fichier dans
// les shells des terminaux Herdr seulement (HC_TERMINAL_ID défini).
//
// La valeur ne passe jamais en argument de commande (visible dans ps) : elle va
// dans un fichier 0600 local, lu par l'entrée standard de `hc exec -i`, puis effacé.
// Le panneau n'affiche que les NOMS des variables, jamais leurs valeurs.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { exec, machines, theme, appHome, writeTextFile, props, closeOverlay, settings } from "herdr";

const NOM_VALIDE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOSSIER = '"$HOME/.config/herdr-vault"';

// Lignes shell exécutées sur la machine choisie (sh POSIX). Le NOM y est
// inséré seulement après validation ; la valeur n'y figure jamais.
const NOMS =
  `f=${DOSSIER}/env; [ -r "$f" ] && sed -n 's/^export \\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p' "$f"; true`;

const CROCHET =
  `for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do ` +
  `if [ -f "$rc" ] || { [ "$rc" = "$HOME/.zshrc" ] && [ "$(basename "\${SHELL:-}")" = zsh ]; }; then ` +
  `grep -q herdr-vault "$rc" 2>/dev/null || printf '\\n# herdr-vault : variables des terminaux Herdr (mod Vault)\\n` +
  `[ -n "$HC_TERMINAL_ID" ] && [ -r "$HOME/.config/herdr-vault/env" ] && . "$HOME/.config/herdr-vault/env"\\n' >> "$rc"; ` +
  `fi; done`;

// Remplace (ou retire, si l'entrée est vide) la ligne `export NOM=` ; écriture atomique en 0600.
const ecrire = (nom) =>
  `set -e; umask 077; d=${DOSSIER}; mkdir -p "$d"; chmod 700 "$d"; f="$d/env"; ` +
  `n=$(mktemp "$f.n.XXXXXX"); t=$(mktemp "$f.XXXXXX"); cat > "$n"; ` +
  `if [ -f "$f" ]; then grep -v '^export ${nom}=' "$f" > "$t" || true; fi; ` +
  `cat "$n" >> "$t"; rm -f "$n"; chmod 600 "$t"; mv -f "$t" "$f"; ${CROCHET}`;

// hc peut être hors du PATH d'une app lancée depuis le Dock (macOS).
const PATH_HC = 'PATH="$HOME/.local/bin:$PATH"; ';

const citer = (v) => "'" + v.replace(/'/g, "'\\''") + "'";
const libelle = (m) => (m === null ? "Ce serveur" : m);

export default class Vault extends View {
  init(_props, cx) {
    this.machine = null; // null : la machine où tourne Herdr
    this.noms = [];
    this.message = "";
    this.erreur = false;
    this.occupe = false;
    this.nom = InputState.new({ placeholder: "NOM_DE_VARIABLE" });
    this.valeur = InputState.new({ placeholder: "valeur (masquée)" });
    this.valeur.set_masked(true);
    this.nom.on("submit", () => this.valeur.focus());
    this.valeur.on("submit", (_e, cx) => this.enregistrer(cx));
    this.handle = cx.focus_handle();
    this.charger(cx);
    this.nom.on("focus", (_e, cx) => { this.saisie = "nom"; cx.notify(); });
    this.valeur.on("focus", (_e, cx) => { this.saisie = "valeur"; cx.notify(); });
    this.nom.on("blur", (_e, cx) => { if (this.saisie === "nom") this.saisie = null; cx.notify(); });
    this.valeur.on("blur", (_e, cx) => { if (this.saisie === "valeur") this.saisie = null; cx.notify(); });
    // En fenêtre (raccourci), le curseur va au nom ; dans le panneau, il reste au terminal.
    if (props()?.overlay) cx.timer.after(300, () => this.nom.focus());
  }

  // Lance une ligne shell sur la machine choisie, l'entrée venant d'un texte (ou rien).
  async lancer(ligne, entree) {
    const on = this.machine === null ? [] : ["--on", this.machine];
    if (entree === undefined) {
      return exec("sh", ["-c", PATH_HC + 'hc exec "$@"', "coffre", ...on, ligne], { timeout: 60000 });
    }
    const dossier = `${appHome()}/.vault-tmp`;
    await exec("sh", ["-c", 'umask 077; mkdir -p "$1"; chmod 700 "$1"', "coffre", dossier]);
    const tmp = `${dossier}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeTextFile(tmp, entree, null);
    try {
      return await exec("sh", ["-c", PATH_HC + 'f="$1"; shift; chmod 600 "$f"; hc exec -i "$@" < "$f"', "coffre", tmp, ...on, ligne],
        { timeout: 60000 });
    } finally {
      await exec("sh", ["-c", 'rm -f -- "$1"', "coffre", tmp]);
    }
  }

  charger(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await this.lancer(NOMS);
        this.noms = r.code === 0 ? r.stdout.split("\n").filter(Boolean).sort() : [];
        if (r.code !== 0) this.dire(`Lecture impossible sur ${libelle(this.machine)} : ${r.stderr.trim().slice(0, 160)}`, true);
      } catch (e) {
        this.noms = [];
        this.dire(`${libelle(this.machine)} injoignable : ${String(e).slice(0, 160)}`, true);
      }
      cx.notify();
    });
  }

  dire(texte, erreur = false) {
    this.message = texte;
    this.erreur = erreur;
  }

  enregistrer(cx) {
    const nom = this.nom.value().trim();
    const valeur = this.valeur.value();
    if (!NOM_VALIDE.test(nom)) { this.dire("Nom invalide : lettres, chiffres et _, sans chiffre au début.", true); cx.notify(); return; }
    if (!valeur) { this.dire("Valeur vide (pour retirer une variable, utilisez « retirer » dans la liste).", true); cx.notify(); return; }
    this.occupe = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.lancer(ecrire(nom), `export ${nom}=${citer(valeur)}\n`);
        if (r.code === 0) {
          this.valeur.set_value("");
          this.nom.set_value("");
          this.dire(`${nom} enregistrée sur ${libelle(this.machine)} (nouveaux terminaux, ou exec $SHELL).`);
        } else this.dire(`Échec sur ${libelle(this.machine)} : ${r.stderr.trim().slice(0, 200)}`, true);
      } catch (e) {
        this.dire(`Échec : ${String(e).slice(0, 200)}`, true);
      }
      this.occupe = false;
      this.charger(cx);
      cx.notify();
    });
  }

  retirer(nom, cx) {
    if (!NOM_VALIDE.test(nom)) return;
    cx.spawn(async (cx) => {
      try {
        const r = await this.lancer(ecrire(nom), "");
        this.dire(r.code === 0 ? `${nom} retirée de ${libelle(this.machine)}.` : `Échec : ${r.stderr.trim().slice(0, 200)}`, r.code !== 0);
      } catch (e) {
        this.dire(`Échec : ${String(e).slice(0, 200)}`, true);
      }
      this.charger(cx);
      cx.notify();
    });
  }

  choisir(machine, cx) {
    this.machine = machine;
    this.noms = [];
    this.dire("");
    this.charger(cx);
    cx.notify();
  }

  touche(e, cx) {
    if (e.key !== "escape") return;
    if (props()?.overlay) { closeOverlay(props().overlay); cx.stop_propagation(); }
    else if (this.saisie) { this.saisie = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
  }

  // Même allure que Files et Changes : carte bordée, en-tête de 42 px, lignes de 28 px, saisie en bas.
  render() {
    const t = theme(), overlay = Boolean(props()?.overlay);
    const liste = [null, ...machines().map((m) => m.name).filter((n) => n)];
    const puce = (m) => {
      const actif = m === this.machine;
      return div().id(`m-${m ?? "local"}`).h(24).px(8).flex().items_center().rounded(6).cursor_pointer().text_size(12)
        .text_color(actif ? t.foreground : t.muted).when(actif, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.choisir(m, cx)).child(libelle(m));
    };
    const champ = (etat, id, quoi) => div().id(id).flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1()
      .border_color(this.saisie === quoi ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(etat).h_full().text_size(12).text_color(t.foreground));
    const pret = !this.occupe;
    const ligne = (n) => h_flex().id(`v-${n}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).hover((s) => s.bg(t.hover))
      .child(svg("mods/vault/vault.svg").size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).child(n))
      .child(div().id(`x-${n}`).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.ansi1))
        .on_click((_e, cx) => this.retirer(n, cx)).child("Retirer"));

    return v_flex().id("vault").size_full().min_h(0).when(overlay, (e) => e.h(480)).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.touche(e, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Vault"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted)
          .child(`${this.noms.length} variable${this.noms.length > 1 ? "s" : ""}`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(overlay ? "Esc" : "0600 · ~/.config/herdr-vault")))
      .child(h_flex().flex_none().p(6).gap(4).flex_wrap().border_b(1).border_color(t.border).children(liste.map(puce)))
      .child(div().flex_1().min_h(44).relative()
        .child(v_flex().id("vault-list").absolute().inset_0().overflow_y_scroll().p(6)
          .children(this.noms.map(ligne))
          .when(!this.noms.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim)
            .child(`Aucune variable sur ${libelle(this.machine)}`))))
        .child(Scrollbar.vertical("vault-list").absolute().inset_0()))
      .when(Boolean(this.message), (e) => e.child(div().px(12).pb(8).text_size(11)
        .text_color(this.erreur ? t.ansi1 : t.dim).child(this.message)))
      .child(v_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(h_flex().gap(8).child(champ(this.nom, "vault-nom", "nom")))
        .child(h_flex().gap(8).child(champ(this.valeur, "vault-valeur", "valeur"))
          .child(div().id("enregistrer").h(32).px(14).flex().items_center().rounded(8).text_size(12)
            .bg(pret ? t.solid : t.raised).text_color(pret ? t.solid_foreground : t.dim)
            .when(pret, (e) => e.cursor_pointer()).on_click((_e, cx) => this.enregistrer(cx))
            .child(this.occupe ? "Enregistrement…" : "Enregistrer"))));
  }
}

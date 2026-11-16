#!/usr/bin/env python3
"""Installe (ou met à jour) le paquet Herdr-Virgile dans une instance de herdr-app, sur macOS ou Linux.

    python3 installer.py            installe ou met à jour, état compris
    python3 installer.py --essai    montre ce qui serait fait, sans rien écrire
    python3 installer.py --sans-etat         layout, mods, thème et raccourci seulement
    python3 installer.py --etat-seulement    l'état seulement (par exemple après un Ctrl-C)
    python3 installer.py --home DIR          une autre maison que ~/.config/herdr-app
    python3 installer.py --pas-de-relance    ne rouvre pas herdr-app après avoir écrit l'état

Ce qu'il fait, dans l'ordre :
1. Copie layouts/, mods/ et themes/ dans la maison de herdr-app. Un fichier ou un mod déjà là et
   différent est d'abord sauvegardé dans ~/herdr-virgile-sauvegardes/<date>/, puis remplacé. Les
   fichiers que herdr-app écrit lui-même dans un mod (*.d.ts, jsconfig.json, fichiers cachés) restent.
   Trace (pane-chat, chat, chat-models, chat-image) n'est pas copié là où Shepherdr est installé :
   le sien, complet, reste en place.
2. Ajoute à keys.json le raccourci du Vault (cmd-shift-y), sauf si la touche sert déjà.
3. Écrit l'état (etat/) : les clés de shared.json (groupes, étiquettes, icônes et couleurs des
   Spaces, groupes et réglages d'Agents, réglages de Session) et ce que Spaces et l'en-tête des
   onglets gardent pour chaque space (déplié, panneau ouvert). herdr-app récrit ces fichiers tant
   qu'il tourne : le script attend qu'il soit fermé (⌘Q ; les terminaux continuent de tourner), écrit,
   puis le rouvre sur macOS. Sans dossier etat/ (le dépôt public), cette étape est sautée.
4. Vérifie chaque mod (`herdr-app check`) et passe au layout Herdr-Virgile.

Il n'installe pas les plugins Claude Code : voir README.md.
"""
import argparse, datetime, filecmp, json, os, shutil, subprocess, sys, tempfile, time

ICI = os.path.dirname(os.path.abspath(__file__))
SAUVE = os.path.join(os.path.expanduser(os.environ.get("HERDR_VIRGILE_SAUVEGARDES", "~/herdr-virgile-sauvegardes")),
                     datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
# Ce que herdr-app écrit lui-même dans un dossier de mod : jamais comparé, jamais retiré.
def a_lui(nom):
    return nom.startswith(".") or nom.endswith(".d.ts") or nom == "jsconfig.json" or nom == "node_modules"


def dire(*a):
    print(*a, flush=True)


class Install:
    def __init__(self, args):
        self.essai = args.essai
        self.home = os.path.abspath(os.path.expanduser(args.home or os.environ.get("HERDR_APP_HOME") or "~/.config/herdr-app"))
        self.paquet = json.load(open(os.path.join(ICI, "paquet.json"), encoding="utf-8"))
        self.cli = shutil.which("herdr-app") or next((p for p in [os.path.expanduser("~/.local/bin/herdr-app")] if os.access(p, os.X_OK)), None)
        self.env = {**os.environ, "HERDR_APP_HOME": self.home}
        self.sauves = 0
        self.ferme_par_nous = False
        # Shepherdr installé ici (lib/addons.json) : son Trace complet est en place, la copie réduite du
        # paquet ne le remplace pas.
        self.shepherdr = os.path.isfile(os.path.join(self.home, "lib", "addons.json"))

    # ---- outils ----------------------------------------------------------------------------
    def herdr(self, *args, timeout=60, env=None):
        if not self.cli:
            return None
        try:
            return subprocess.run([self.cli, *args], env=env or self.env, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            return None

    def tourne(self):
        """herdr-app a-t-il une fenêtre ouverte sur cette maison ?"""
        # `herdr-app status` répond par la fenêtre de cette maison (son herdr-app.sock), sinon échoue.
        r = self.herdr("status", timeout=10)
        if r is not None:
            return r.returncode == 0 and '"layout"' in r.stdout
        # Sans le CLI : le processus de l'app.
        motif = "Herdr.app/Contents/MacOS/Herdr" if sys.platform == "darwin" else "herdr-app"
        return subprocess.run(["pgrep", "-f", motif], capture_output=True).returncode == 0

    def sauvegarder(self, chemin):
        """Copie un fichier ou un dossier de la maison avant de le changer."""
        rel = os.path.relpath(chemin, self.home)
        dest = os.path.join(SAUVE, rel)
        if self.essai:
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.isdir(chemin):
            shutil.copytree(chemin, dest, ignore=lambda _d, noms: [n for n in noms if n == "node_modules"])
        else:
            shutil.copy2(chemin, dest)
        self.sauves += 1

    def ecrire_json(self, chemin, valeur, mode=None):
        if self.essai:
            return
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        tmp = chemin + ".herdr-virgile-tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(valeur, f, indent=1, ensure_ascii=False)
            f.write("\n")
        if mode is not None:
            os.chmod(tmp, mode)
        elif os.path.exists(chemin):
            os.chmod(tmp, os.stat(chemin).st_mode & 0o777)
        os.replace(tmp, chemin)

    # ---- 1. les fichiers -------------------------------------------------------------------
    def fichier(self, rel):
        src, dst = os.path.join(ICI, rel), os.path.join(self.home, rel)
        if os.path.isfile(dst) and filecmp.cmp(src, dst, shallow=False):
            return "inchangé"
        etat = "mis à jour" if os.path.exists(dst) else "ajouté"
        if os.path.exists(dst):
            self.sauvegarder(dst)
        if not self.essai:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        return etat

    def mod(self, nom):
        src, dst = os.path.join(ICI, "mods", nom), os.path.join(self.home, "mods", nom)
        voulus = set()
        for racine, dossiers, fichiers in os.walk(src):
            dossiers[:] = [d for d in dossiers if not a_lui(d)]
            for f in fichiers:
                if not a_lui(f):
                    voulus.add(os.path.relpath(os.path.join(racine, f), src))
        if not os.path.isdir(dst):
            if not self.essai:
                shutil.copytree(src, dst, ignore=lambda _d, noms: [n for n in noms if a_lui(n)])
            return "ajouté", len(voulus), 0
        presents = set()
        for racine, dossiers, fichiers in os.walk(dst):
            dossiers[:] = [d for d in dossiers if not a_lui(d)]
            for f in fichiers:
                if not a_lui(f):
                    presents.add(os.path.relpath(os.path.join(racine, f), dst))
        changes = [r for r in voulus if r not in presents or not filecmp.cmp(os.path.join(src, r), os.path.join(dst, r), shallow=False)]
        en_trop = sorted(presents - voulus)
        if not changes and not en_trop:
            return "inchangé", 0, 0
        self.sauvegarder(dst)
        if not self.essai:
            for r in en_trop:
                os.remove(os.path.join(dst, r))
            for r in changes:
                os.makedirs(os.path.dirname(os.path.join(dst, r)), exist_ok=True)
                shutil.copy2(os.path.join(src, r), os.path.join(dst, r))
        return "mis à jour", len(changes), len(en_trop)

    def fichiers(self):
        dire(f"\n1. Layout, mods et thème → {self.home}")
        p = self.paquet
        dire(f"   layouts/{p['layout']}.json : {self.fichier(os.path.join('layouts', p['layout'] + '.json'))}")
        for t in p["themes"]:
            dire(f"   themes/{t} : {self.fichier(os.path.join('themes', t))}")
        for m in p["mods"]:
            if m in p.get("trace", []) and self.shepherdr and os.path.isdir(os.path.join(self.home, "mods", m)):
                dire(f"   mods/{m} : gardé (Shepherdr est installé ici : son Trace reste en place)")
                continue
            etat, n, retires = self.mod(m)
            detail = "" if etat == "inchangé" else f" ({n} fichier{'s' if n > 1 else ''}" + (f", {retires} retiré{'s' if retires > 1 else ''}" if retires else "") + ")"
            dire(f"   mods/{m} : {etat}{detail}")

    # ---- 2. le raccourci -------------------------------------------------------------------
    def touches(self):
        dire("\n2. Raccourcis (keys.json)")
        chemin = os.path.join(self.home, "keys.json")
        try:
            k = json.load(open(chemin, encoding="utf-8")) if os.path.exists(chemin) else {}
        except ValueError:
            dire("   ! keys.json n'est pas du JSON valide : rien n'est ajouté.")
            return
        changer = False
        for section, liens in self.paquet["touches"].items():
            for touche, action in liens.items():
                deja = k.get(section, {}).get(touche)
                if deja == action:
                    dire(f"   {touche} → {action} : déjà là")
                elif deja:
                    dire(f"   ! {touche} sert déjà à « {deja} » : pas changé. Choisissez une autre touche pour {action}.")
                else:
                    k.setdefault(section, {})[touche] = action
                    changer = True
                    dire(f"   {touche} → {action} : ajouté")
        if changer:
            if os.path.exists(chemin):
                self.sauvegarder(chemin)
            self.ecrire_json(chemin, k)

    # ---- 3. l'état -------------------------------------------------------------------------
    @staticmethod
    def fusion(ancien, nouveau, fusionner):
        """fusionner : les dictionnaires gardent les entrées de l'instance que le paquet n'a pas, les
        listes s'unissent ; sinon la valeur du paquet remplace celle de l'instance."""
        if fusionner and isinstance(ancien, dict) and isinstance(nouveau, dict):
            return {**ancien, **nouveau}
        if fusionner and isinstance(ancien, list) and isinstance(nouveau, list):
            return ancien + [x for x in nouveau if x not in ancien]
        return nouveau

    def etat(self, relancer):
        dire("\n3. Votre état (groupes, étiquettes, icônes, réglages)")
        etat = json.load(open(os.path.join(ICI, "etat", "shared.json"), encoding="utf-8"))
        stores = {}
        dos = os.path.join(ICI, "etat", "stores")
        if os.path.isdir(dos):
            for f in sorted(os.listdir(dos)):
                if f.endswith(".json"):
                    stores[f[:-5]] = json.load(open(os.path.join(dos, f), encoding="utf-8"))
        if self.essai:
            dire(f"   (essai) écrirait {len(etat)} clés de shared.json : {', '.join(sorted(etat))}")
            for m, v in stores.items():
                dire(f"   (essai) écrirait data/{m}/store.json : {', '.join(sorted(v))}")
            return
        if self.tourne():
            dire("   herdr-app est ouvert : il récrit ces fichiers tant qu'il tourne.")
            dire("   → Quittez herdr-app (⌘Q). Vos terminaux et agents continuent de tourner.")
            dire("     L'état sera écrit dès la fermeture. (Ctrl-C pour passer ; plus tard : --etat-seulement)")
            try:
                while self.tourne():
                    time.sleep(1)
            except KeyboardInterrupt:
                dire("\n   État non écrit. Relancez `python3 installer.py --etat-seulement` herdr-app fermé.")
                return
            self.ferme_par_nous = True
            time.sleep(1.5)  # le temps que herdr-app finisse d'écrire shared.json en partant
        chemin = os.path.join(self.home, "shared.json")
        try:
            actuel = json.load(open(chemin, encoding="utf-8")) if os.path.exists(chemin) else {}
        except ValueError:
            dire("   ! shared.json n'est pas du JSON valide : état non écrit.")
            return
        fusionner = set(self.paquet["etat"]["fusionner"])
        neuf = dict(actuel)
        for cle, v in etat.items():
            neuf[cle] = self.fusion(actuel.get(cle), v, cle in fusionner)
        if neuf != actuel:
            if os.path.exists(chemin):
                self.sauvegarder(chemin)
            self.ecrire_json(chemin, neuf)
        dire(f"   shared.json : {len(etat)} clés ({', '.join(sorted(etat))})")
        for m, valeurs in stores.items():
            c = os.path.join(self.home, "data", m, "store.json")
            try:
                s = json.load(open(c, encoding="utf-8")) if os.path.exists(c) else {}
            except ValueError:
                dire(f"   ! data/{m}/store.json illisible : passé.")
                continue
            n = dict(s)
            for cle, v in valeurs.items():
                # Les valeurs de localStorage sont du JSON en texte : fusionné comme ci-dessus.
                try:
                    n[cle] = json.dumps(self.fusion(json.loads(s[cle]), json.loads(v), True), ensure_ascii=False) if cle in s else v
                except (ValueError, TypeError):
                    n[cle] = v
            if n != s:
                if os.path.exists(c):
                    self.sauvegarder(c)
                self.ecrire_json(c, n, mode=0o600)
            dire(f"   data/{m}/store.json : {', '.join(sorted(valeurs))}")
        # herdr-app a pu écrire shared.json juste après avoir fermé sa fenêtre : on relit, et on
        # récrit une fois si nos clés n'y sont plus.
        if self.ferme_par_nous:
            time.sleep(2.5)
            try:
                relu = json.load(open(chemin, encoding="utf-8"))
            except (OSError, ValueError):
                relu = {}
            if any(relu.get(c) != neuf.get(c) for c in etat):
                dire("   herdr-app a récrit shared.json en partant : état écrit une seconde fois.")
                self.ecrire_json(chemin, {**relu, **{c: neuf[c] for c in etat}})
        if self.ferme_par_nous and relancer and sys.platform == "darwin":
            dire("   Réouverture de herdr-app…")
            subprocess.run(["open", "-b", "dev.herdr.app"], capture_output=True)
            for _ in range(40):
                if self.tourne():
                    break
                time.sleep(0.5)
        elif self.ferme_par_nous:
            dire("   Rouvrez herdr-app.")

    # ---- 4. vérifications --------------------------------------------------------------------
    def verifier(self):
        dire("\n4. Vérification")
        if not self.cli:
            dire("   ! herdr-app introuvable dans le PATH : vérifiez à la main (`herdr-app check <mod>`).")
            return
        if self.essai:
            dire("   (essai) lancerait herdr-app check sur chaque mod, puis layout.switch")
            return
        v = self.herdr("--version", timeout=10)
        version = (v.stdout.strip().split()[-1] if v and v.stdout.strip() else "?")
        if version != self.paquet["herdr_app"]:
            dire(f"   ! herdr-app {version} ici, {self.paquet['herdr_app']} à l'export : les copies de mods livrés (tabs, spaces, agents) peuvent ne plus suivre.")
        ok = True
        # `herdr-app check` fait tourner le mod une fois et garde ce qu'il range dans le shared.json de
        # sa maison (HERDR_APP_HOME). Sans spaces, Spaces y efface par exemple toutes les couleurs des
        # spaces. Il tourne donc avec une maison jetable, jamais celle de l'instance.
        jetable = tempfile.mkdtemp(prefix="hv-")
        env = {**os.environ, "HERDR_APP_HOME": jetable}
        for m in self.paquet["mods"]:
            r = self.herdr("check", os.path.join(self.home, "mods", m), timeout=120, env=env)
            bon = r is not None and r.returncode == 0
            ok &= bon
            dire(f"   {'ok' if bon else '!! ÉCHEC'}  {m}" + ("" if bon else f" : {(r.stderr or r.stdout).strip()[:300] if r else 'pas de réponse'}"))
        shutil.rmtree(jetable, ignore_errors=True)
        if self.tourne():
            r = self.herdr("do", "layout.switch", json.dumps({"name": self.paquet["layout"]}), timeout=20)
            dire(f"   layout {self.paquet['layout']} : {'affiché' if r and r.returncode == 0 else 'à choisir à la main (ctrl-shift-l)'}")
        else:
            dire(f"   Au prochain lancement : ctrl-shift-l ou `herdr-app do layout.switch '{{\"name\":\"{self.paquet['layout']}\"}}'`.")
        return ok


def main():
    ap = argparse.ArgumentParser(description="Installe le paquet Herdr-Virgile dans herdr-app.")
    ap.add_argument("--essai", action="store_true", help="montrer sans rien écrire")
    ap.add_argument("--home", help="la maison de herdr-app (défaut : $HERDR_APP_HOME ou ~/.config/herdr-app)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--sans-etat", action="store_true", help="ne pas écrire l'état")
    g.add_argument("--etat-seulement", action="store_true", help="écrire seulement l'état")
    ap.add_argument("--pas-de-relance", action="store_true", help="ne pas rouvrir herdr-app après l'état")
    args = ap.parse_args()
    i = Install(args)
    p = i.paquet
    dire(f"Paquet {p['layout']} exporté le {p['exporte_le']} (herdr-app {p['herdr_app']}){' — ESSAI, rien n’est écrit' if i.essai else ''}")
    if not os.path.isdir(i.home):
        sys.exit(f"{i.home} n'existe pas : lancez herdr-app une fois, ou donnez --home.")
    if not args.etat_seulement:
        i.fichiers()
        i.touches()
    # Le dépôt public (et un export --sans-etat) n'a pas de dossier etat/ : l'état est sauté.
    a_etat = os.path.isfile(os.path.join(ICI, "etat", "shared.json"))
    if args.etat_seulement and not a_etat:
        sys.exit("Ce paquet ne contient pas d'état (pas de dossier etat/) : rien à écrire.")
    if not args.sans_etat and not a_etat:
        dire("\n3. Votre état : ce paquet n'en contient pas (pas de dossier etat/), rien à écrire.")
    elif not args.sans_etat:
        i.etat(not args.pas_de_relance)
    ok = i.verifier()
    if i.sauves:
        dire(f"\nAnciennes versions sauvegardées dans {SAUVE}")
    dire("\nPlugins Claude Code à installer sur chaque machine : voir README.md.")
    sys.exit(0 if ok is not False else 1)


if __name__ == "__main__":
    main()

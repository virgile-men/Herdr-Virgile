#!/usr/bin/env python3
"""Installs (or updates) the Herdr-Virgile package into a herdr-app instance, on macOS or Linux.

    python3 installer.py                 install or update, state included
    python3 installer.py --dry-run       show what would be done, write nothing
    python3 installer.py --no-state      layout, mods, theme and shortcut only
    python3 installer.py --state-only    the state only (for example after a Ctrl-C)
    python3 installer.py --home DIR      another home than ~/.config/herdr-app
    python3 installer.py --no-relaunch   don't reopen herdr-app after writing the state
(The French option names --essai, --sans-etat, --etat-seulement and --pas-de-relance still work.)

What it does, in order:
1. Copies layouts/, mods/ and themes/ into herdr-app's home. A file or mod already there and
   different is first backed up to ~/herdr-virgile-sauvegardes/<date>/, then replaced. Files that
   herdr-app writes into a mod itself (*.d.ts, jsconfig.json, hidden files) stay.
   Trace (pane-chat, chat, chat-models, chat-image) is not copied where Shepherdr is installed:
   its own, complete Trace stays in place.
2. Adds the Vault shortcut (cmd-shift-y) to keys.json, unless that key is already taken.
3. Writes the state (etat/): the shared.json keys (Spaces groups, labels, icons and colors, Agents
   groups and settings, Session settings) and what Spaces and the tab bar keep for each space
   (expanded, open panel). herdr-app rewrites these files while it runs: the script waits until it
   is closed (⌘Q; terminals keep running), writes, then reopens it on macOS. Without an etat/ folder
   (the public repository), this step is skipped.
4. Checks every mod (`herdr-app check`) and switches to the Herdr-Virgile layout.

It doesn't install the Claude Code plugins: see README.md.
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
            return "unchanged"
        etat = "updated" if os.path.exists(dst) else "added"
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
            return "added", len(voulus), 0
        presents = set()
        for racine, dossiers, fichiers in os.walk(dst):
            dossiers[:] = [d for d in dossiers if not a_lui(d)]
            for f in fichiers:
                if not a_lui(f):
                    presents.add(os.path.relpath(os.path.join(racine, f), dst))
        changes = [r for r in voulus if r not in presents or not filecmp.cmp(os.path.join(src, r), os.path.join(dst, r), shallow=False)]
        en_trop = sorted(presents - voulus)
        if not changes and not en_trop:
            return "unchanged", 0, 0
        self.sauvegarder(dst)
        if not self.essai:
            for r in en_trop:
                os.remove(os.path.join(dst, r))
            for r in changes:
                os.makedirs(os.path.dirname(os.path.join(dst, r)), exist_ok=True)
                shutil.copy2(os.path.join(src, r), os.path.join(dst, r))
        return "updated", len(changes), len(en_trop)

    def fichiers(self):
        dire(f"\n1. Layout, mods and theme → {self.home}")
        p = self.paquet
        dire(f"   layouts/{p['layout']}.json: {self.fichier(os.path.join('layouts', p['layout'] + '.json'))}")
        for t in p["themes"]:
            dire(f"   themes/{t}: {self.fichier(os.path.join('themes', t))}")
        for m in p["mods"]:
            if m in p.get("trace", []) and self.shepherdr and os.path.isdir(os.path.join(self.home, "mods", m)):
                dire(f"   mods/{m}: kept (Shepherdr is installed here: its Trace stays in place)")
                continue
            etat, n, retires = self.mod(m)
            detail = "" if etat == "unchanged" else f" ({n} file{'s' if n != 1 else ''}" + (f", {retires} removed" if retires else "") + ")"
            dire(f"   mods/{m}: {etat}{detail}")

    # ---- 2. le raccourci -------------------------------------------------------------------
    def touches(self):
        dire("\n2. Shortcuts (keys.json)")
        chemin = os.path.join(self.home, "keys.json")
        try:
            k = json.load(open(chemin, encoding="utf-8")) if os.path.exists(chemin) else {}
        except ValueError:
            dire("   ! keys.json is not valid JSON: nothing added.")
            return
        changer = False
        for section, liens in self.paquet["touches"].items():
            for touche, action in liens.items():
                deja = k.get(section, {}).get(touche)
                if deja == action:
                    dire(f"   {touche} → {action}: already there")
                elif deja:
                    dire(f"   ! {touche} is already used for \"{deja}\": not changed. Pick another key for {action}.")
                else:
                    k.setdefault(section, {})[touche] = action
                    changer = True
                    dire(f"   {touche} → {action}: added")
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
        dire("\n3. Your state (groups, labels, icons, settings)")
        etat = json.load(open(os.path.join(ICI, "etat", "shared.json"), encoding="utf-8"))
        stores = {}
        dos = os.path.join(ICI, "etat", "stores")
        if os.path.isdir(dos):
            for f in sorted(os.listdir(dos)):
                if f.endswith(".json"):
                    stores[f[:-5]] = json.load(open(os.path.join(dos, f), encoding="utf-8"))
        if self.essai:
            dire(f"   (dry run) would write {len(etat)} shared.json keys: {', '.join(sorted(etat))}")
            for m, v in stores.items():
                dire(f"   (dry run) would write data/{m}/store.json: {', '.join(sorted(v))}")
            return
        if self.tourne():
            dire("   herdr-app is open: it rewrites these files while it runs.")
            dire("   → Quit herdr-app (⌘Q). Your terminals and agents keep running.")
            dire("     The state is written as soon as it closes. (Ctrl-C to skip; later: --state-only)")
            try:
                while self.tourne():
                    time.sleep(1)
            except KeyboardInterrupt:
                dire("\n   State not written. Run `python3 installer.py --state-only` with herdr-app closed.")
                return
            self.ferme_par_nous = True
            time.sleep(1.5)  # le temps que herdr-app finisse d'écrire shared.json en partant
        chemin = os.path.join(self.home, "shared.json")
        try:
            actuel = json.load(open(chemin, encoding="utf-8")) if os.path.exists(chemin) else {}
        except ValueError:
            dire("   ! shared.json is not valid JSON: state not written.")
            return
        fusionner = set(self.paquet["etat"]["fusionner"])
        neuf = dict(actuel)
        for cle, v in etat.items():
            neuf[cle] = self.fusion(actuel.get(cle), v, cle in fusionner)
        if neuf != actuel:
            if os.path.exists(chemin):
                self.sauvegarder(chemin)
            self.ecrire_json(chemin, neuf)
        dire(f"   shared.json: {len(etat)} keys ({', '.join(sorted(etat))})")
        for m, valeurs in stores.items():
            c = os.path.join(self.home, "data", m, "store.json")
            try:
                s = json.load(open(c, encoding="utf-8")) if os.path.exists(c) else {}
            except ValueError:
                dire(f"   ! data/{m}/store.json unreadable: skipped.")
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
            dire(f"   data/{m}/store.json: {', '.join(sorted(valeurs))}")
        # herdr-app a pu écrire shared.json juste après avoir fermé sa fenêtre : on relit, et on
        # récrit une fois si nos clés n'y sont plus.
        if self.ferme_par_nous:
            time.sleep(2.5)
            try:
                relu = json.load(open(chemin, encoding="utf-8"))
            except (OSError, ValueError):
                relu = {}
            if any(relu.get(c) != neuf.get(c) for c in etat):
                dire("   herdr-app rewrote shared.json as it quit: state written a second time.")
                self.ecrire_json(chemin, {**relu, **{c: neuf[c] for c in etat}})
        if self.ferme_par_nous and relancer and sys.platform == "darwin":
            dire("   Reopening herdr-app…")
            subprocess.run(["open", "-b", "dev.herdr.app"], capture_output=True)
            for _ in range(40):
                if self.tourne():
                    break
                time.sleep(0.5)
        elif self.ferme_par_nous:
            dire("   Reopen herdr-app.")

    # ---- 4. vérifications --------------------------------------------------------------------
    def verifier(self):
        dire("\n4. Checks")
        if not self.cli:
            dire("   ! herdr-app not found on PATH: check by hand (`herdr-app check <mod>`).")
            return
        if self.essai:
            dire("   (dry run) would run herdr-app check on every mod, then layout.switch")
            return
        v = self.herdr("--version", timeout=10)
        version = (v.stdout.strip().split()[-1] if v and v.stdout.strip() else "?")
        if version != self.paquet["herdr_app"]:
            dire(f"   ! herdr-app {version} here, {self.paquet['herdr_app']} at export: the copies of shipped mods (tabs, spaces, agents) may no longer match.")
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
            dire(f"   {'ok' if bon else '!! FAILED'}  {m}" + ("" if bon else f": {(r.stderr or r.stdout).strip()[:300] if r else 'no answer'}"))
        shutil.rmtree(jetable, ignore_errors=True)
        if self.tourne():
            r = self.herdr("do", "layout.switch", json.dumps({"name": self.paquet["layout"]}), timeout=20)
            dire(f"   layout {self.paquet['layout']}: {'shown' if r and r.returncode == 0 else 'pick it by hand (ctrl-shift-l)'}")
        else:
            dire(f"   Next time herdr-app starts: ctrl-shift-l or `herdr-app do layout.switch '{{\"name\":\"{self.paquet['layout']}\"}}'`.")
        return ok


def main():
    ap = argparse.ArgumentParser(description="Installs the Herdr-Virgile package into herdr-app.")
    ap.add_argument("--dry-run", "--essai", dest="essai", action="store_true", help="show, write nothing")
    ap.add_argument("--home", help="herdr-app's home (default: $HERDR_APP_HOME or ~/.config/herdr-app)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--no-state", "--sans-etat", dest="sans_etat", action="store_true", help="don't write the state")
    g.add_argument("--state-only", "--etat-seulement", dest="etat_seulement", action="store_true", help="write the state only")
    ap.add_argument("--no-relaunch", "--pas-de-relance", dest="pas_de_relance", action="store_true", help="don't reopen herdr-app after the state")
    args = ap.parse_args()
    i = Install(args)
    p = i.paquet
    dire(f"Package {p['layout']} exported {p['exporte_le']} (herdr-app {p['herdr_app']}){' — DRY RUN, nothing is written' if i.essai else ''}")
    if not os.path.isdir(i.home):
        sys.exit(f"{i.home} doesn't exist: start herdr-app once, or pass --home.")
    if not args.etat_seulement:
        i.fichiers()
        i.touches()
    # Le dépôt public (et un export --sans-etat) n'a pas de dossier etat/ : l'état est sauté.
    a_etat = os.path.isfile(os.path.join(ICI, "etat", "shared.json"))
    if args.etat_seulement and not a_etat:
        sys.exit("This package has no state (no etat/ folder): nothing to write.")
    if not args.sans_etat and not a_etat:
        dire("\n3. Your state: this package has none (no etat/ folder), nothing to write.")
    elif not args.sans_etat:
        i.etat(not args.pas_de_relance)
    ok = i.verifier()
    if i.sauves:
        dire(f"\nPrevious versions backed up to {SAUVE}")
    dire("\nClaude Code plugins to install on each machine: see README.md.")
    sys.exit(0 if ok is not False else 1)


if __name__ == "__main__":
    main()

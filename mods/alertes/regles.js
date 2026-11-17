// Section Règles du panneau Alertes (l'ancien panneau Règles) : les corrections que le mod Claude
// reflect-mod a reconnues comme des règles durables, à garder dans CLAUDE.md, comme sa bande au-dessus du
// prompt : enregistrer dans ./CLAUDE.md ou ~/.claude/CLAUDE.md, changer de portée, reformuler, ignorer.
// Repliés : une règle tapée à la main, et les règles déjà décidées. La pause est dans le titre.
//
// La détection reste le travail du plugin, dans Claude Code (un appel à haiku par message court) : il range
// ce qu'il trouve dans son store, ~/.claude/plugins/store/reflect-mod_*.json, sur la machine de l'agent.
// Cette section lit ce store et y écrit la décision (saved, skipped), puis ajoute la règle dans la section
// marquée de CLAUDE.md, avec la même fonction que le plugin (withRule). Chaque écriture vérifie que le
// fichier n'a pas changé depuis sa lecture (sinon on relit et on recommence). Ce que le plugin n'a pas
// d'équivalent ici : la règle ajoutée au prompt système de la session en cours (elle est dans CLAUDE.md).
// Les règles en attente de chaque machine sont aussi notées pour l'en-tête (notifs.js, noterAttente).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, appHome, writeTextFile } from "herdr";
import { cible, session, sh, machineDe } from "./claude.js";
import { noterAttente } from "./notifs.js";
// Dates written by hand: the mod runtime ignores toLocale*'s locale and options ("11/16/2026, 02:56:15 AM").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const dayMonth = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

const MAX_RULE = 200;
const SAME = 0.6;
const START = "<!-- claude-reflect: learned rules (saved from the band; edit freely) -->";
const END = "<!-- end claude-reflect -->";
const SECRET = [
  /\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|glpat)[-_][A-Za-z0-9_-]{8,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/,
  /(password|passwd|passphrase|secret|token|api[ _-]?key|пароль|токен|ключ)\s*(\bis\b|:|=)\s*\S{4,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// ---- Copié de reflect-mod 3.3.0 (hooks/register.tsx) ----------------------------------------
function pairs(s) {
  const words = s.toLowerCase().replace(/[^\p{L}\p{N}+#.\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  if (words.length === 1) out.add(words[0] ?? "");
  for (let i = 0; i + 1 < words.length; i += 1) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}
function similarity(a, b) {
  const x = pairs(a), y = pairs(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const p of x) if (y.has(p)) both += 1;
  return both / (x.size + y.size - both);
}
const looksSecret = (s) => SECRET.some((re) => re.test(s));
function cleanRule(raw) {
  const rule = raw.trim().replace(/^[-*]\s+/, "");
  if (rule === "" || rule.length > MAX_RULE) return undefined;
  if (/[\r\n\u0000-\u001f\u007f]/.test(rule) || rule.includes("<!--") || rule.includes("-->")) return undefined;
  if (looksSecret(rule)) return undefined;
  return rule;
}
// Le fichier avec la règle en puce dans la section marquée ; inchangé si une puce semblable y est ;
// undefined si les marqueurs sont cassés (jamais deviner où écrire).
function withRule(file, rule) {
  const bullets = file.split("\n").filter((line) => /^\s*[-*] /.test(line));
  if (bullets.some((line) => similarity(line.replace(/^\s*[-*]\s+/, ""), rule) >= 0.8)) return file;
  const starts = file.split(START).length - 1;
  const ends = file.split(END).length - 1;
  if (starts === 0 && ends === 0) {
    const sep = file === "" || file.endsWith("\n\n") ? "" : file.endsWith("\n") ? "\n" : "\n\n";
    return `${file}${sep}${START}\n## Learned rules\n- ${rule}\n${END}\n`;
  }
  const start = file.indexOf(START);
  const end = file.indexOf(END);
  if (starts !== 1 || ends !== 1 || end < start) return undefined;
  return `${file.slice(0, end)}- ${rule}\n${file.slice(end)}`;
}
// ----------------------------------------------------------------------------------------------

// Lit un fichier sur la machine : sa somme (pour vérifier avant d'écrire) puis son contenu.
// "@store" : le store du plugin ; "@global" : ~/.claude/CLAUDE.md.
const LIRE = String.raw`
f="$1"
case "$f" in
  @store) f=""; for x in "$HOME"/.claude/plugins/store/reflect-mod_*.json; do [ -f "$x" ] && f="$x"; done
          [ -n "$f" ] || f="$HOME/.claude/plugins/store/reflect-mod_claude-reflect-marketplace.json";;
  @global) f="$HOME/.claude/CLAUDE.md";;
esac
on=0; grep -q '"reflect-mod@[^"]*": *true' "$HOME/.claude/settings.json" 2>/dev/null && on=1
echo "$f"; echo "$on"
if [ -f "$f" ]; then cksum < "$f" | tr -d ' \t'; cat "$f"; else echo absent; fi`;

// Remplace un fichier par l'entrée standard, seulement s'il a encore la somme lue (sinon code 9).
const ECRIRE = (f, attendu, mode) => {
  const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  return `f=${q(f)}; attendu=${q(attendu)}; d=$(dirname "$f"); mkdir -p "$d" || exit 3; ` +
    `t=$(mktemp "$f.XXXXXX") || exit 3; cat > "$t"; ` +
    `if [ -f "$f" ]; then cur=$(cksum < "$f" | tr -d ' \\t'); else cur=absent; fi; ` +
    `[ "$cur" = "$attendu" ] || { rm -f "$t"; echo "le fichier a changé" >&2; exit 9; }; ` +
    `chmod ${mode} "$t"; mv -f "$t" "$f"`;
};
const PATH_HC = 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';
const nomDossier = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? p;

export class SectionRegles {
  constructor() {
    this.addr = undefined;
    this.machine = null;
    this.racine = null;     // le dossier de la session suivie (le « dépôt » du plugin)
    this.store = null;      // { path, sum, data, plugin }
    this.erreur = null;
    this.note = null;
    this.occupe = false;
    this.edition = null;    // { id, etat }
    this.ouvert = { ajouter: false, decidees: false };
    this.nouvelle = InputState.new({ placeholder: "A rule to keep (one line, no secrets)" });
    this.nouvelle.on("focus", (_e, cx) => { this.saisie = "nouvelle"; cx.notify(); });
    this.nouvelle.on("blur", (_e, cx) => { if (this.saisie === "nouvelle") this.saisie = null; cx.notify(); });
  }

  suivre(cx) {
    const a = cible() ?? null;
    if (a === this.addr) return;
    this.addr = a;
    this.machine = machineDe(a);
    this.racine = null;
    this.store = null;
    this.edition = null;
    this.charger(cx);
  }

  attente() { return (this.store?.data?.items ?? []).filter((l) => l.status === "pending"); }
  enPause() { return this.store?.data?.paused === true; }

  async lire(chemin) {
    const r = await sh(LIRE, [chemin], this.machine, 20000);
    if (r.code !== 0) throw new Error((r.stderr || "couldn't read the file").trim().slice(0, 200));
    const [path, on, sum, ...reste] = r.stdout.split("\n");
    return { path, plugin: on === "1", sum, texte: sum === "absent" ? "" : reste.join("\n") };
  }

  // Écrit sur la machine de l'agent : le texte passe par un fichier local 0600 lu par `hc exec -i`.
  async ecrire(path, texte, attendu, mode) {
    const dossier = `${appHome()}/.regles-tmp`;
    await exec("sh", ["-c", 'umask 077; mkdir -p "$1"', "regles", dossier]);
    const tmp = `${dossier}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeTextFile(tmp, texte, null);
    try {
      const on = this.machine ? ["--on", this.machine] : [];
      const r = await exec("sh", ["-c", PATH_HC + 'f="$1"; shift; hc exec -i "$@" < "$f"', "regles", tmp, ...on, ECRIRE(path, attendu, mode)]);
      if (r.code === 9 || /a changé/.test(r.stderr)) return false;
      if (r.code !== 0) throw new Error((r.stderr || "couldn't write the file").trim().slice(0, 200));
      return true;
    } finally {
      await exec("sh", ["-c", 'rm -f -- "$1"', "regles", tmp]);
    }
  }

  charger(cx) {
    if (this.occupe) return;
    const addr = this.addr;
    this.occupe = true;
    cx.spawn(async (cx) => {
      try {
        if (addr && !this.racine) {
          const s = await session(addr);
          if (!s.erreur) this.racine = s.cwd;
        }
        const st = await this.lire("@store");
        if (this.addr !== addr) return;
        let data = { items: [] };
        if (st.texte.trim()) { try { data = JSON.parse(st.texte); } catch { throw new Error(`Unreadable store: ${st.path}`); } }
        if (!Array.isArray(data.items)) data.items = [];
        this.store = { path: st.path, sum: st.sum, data, plugin: st.plugin };
        this.erreur = null;
        noterAttente(this.machine, data.items.filter((l) => l.status === "pending"));
      } catch (e) {
        if (this.addr === addr) this.erreur = String(e?.message ?? e).slice(0, 200);
      } finally {
        this.occupe = false;
        cx.notify();
      }
    });
  }

  // Change le store : fn(data) le modifie sur place. Relu et recommencé si le plugin l'a écrit entre-temps.
  async changerStore(fn) {
    for (let i = 0; i < 3; i += 1) {
      const st = await this.lire("@store");
      let data = { items: [] };
      if (st.texte.trim()) data = JSON.parse(st.texte);
      if (!Array.isArray(data.items)) data.items = [];
      if (fn(data) === false) return data;
      if (await this.ecrire(st.path, JSON.stringify(data, null, 2) + "\n", st.sum, "600")) {
        this.store = { ...this.store, path: st.path, data };
        return data;
      }
    }
    throw new Error("The store keeps changing: try again.");
  }

  // Ajoute la règle à CLAUDE.md (portée globale ou ce dépôt). -> le message à afficher.
  async ajouterAuFichier(regle, portee, projet) {
    const cible = portee === "global" ? "@global" : `${projet}/CLAUDE.md`;
    for (let i = 0; i < 3; i += 1) {
      const f = await this.lire(cible);
      const apres = withRule(f.texte, regle);
      if (apres === undefined) throw new Error(`The claude-reflect markers in ${f.path} are broken: fix them by hand. Nothing was written.`);
      if (apres === f.texte) return `Already in ${f.path}.`;
      if (await this.ecrire(f.path, apres, f.sum, "644")) return `Saved to ${f.path}.`;
    }
    throw new Error("The file keeps changing: try again.");
  }

  agir(cx, travail) {
    if (this.occupe) return;
    this.occupe = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.note = await travail(); this.erreur = null; }
      catch (e) { this.erreur = String(e?.message ?? e).slice(0, 240); }
      finally { this.occupe = false; cx.notify(); this.charger(cx); }
    });
  }

  enregistrer(item, portee, cx, texte) {
    const regle = cleanRule(texte ?? item.rule);
    if (!regle) { this.erreur = "Rule rejected: one line, no secrets, 200 characters max."; cx.notify(); return; }
    const projet = portee === "project" ? (item.project || this.racine) : item.project;
    if (portee === "project" && !projet) { this.erreur = "No known project folder for this rule."; cx.notify(); return; }
    this.agir(cx, async () => {
      const msg = await this.ajouterAuFichier(regle, portee, projet);
      await this.changerStore((data) => {
        const one = data.items.find((l) => l.id === item.id);
        if (!one) return false;
        one.status = "saved"; one.scope = portee; one.rule = regle;
        if (projet) one.project = projet;
      });
      this.edition = null;
      return msg;
    });
  }

  ignorer(item, cx) {
    this.agir(cx, async () => {
      await this.changerStore((data) => {
        const one = data.items.find((l) => l.id === item.id);
        if (!one || one.status !== "pending") return false;
        one.status = "skipped";
      });
      return "Ignored.";
    });
  }

  // Une règle tapée ici : écrite tout de suite, et gardée dans le store comme enregistrée (le plugin
  // ne la reproposera pas).
  ajouter(portee, cx) {
    const regle = cleanRule(this.nouvelle.value());
    if (!regle) { this.erreur = "Rule rejected: one line, no secrets, 200 characters max."; cx.notify(); return; }
    if (portee === "project" && !this.racine) { this.erreur = "No active session: no repo to write to."; cx.notify(); return; }
    this.agir(cx, async () => {
      const msg = await this.ajouterAuFichier(regle, portee, this.racine);
      const now = Date.now();
      await this.changerStore((data) => {
        data.items.push({ id: `r${now.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`, rule: regle, scope: portee,
          project: this.racine ?? "", count: 1, firstAt: now, lastAt: now, status: "saved", confidence: 1 });
      });
      this.nouvelle.set_value("");
      return msg;
    });
  }

  pause(cx) {
    this.agir(cx, async () => {
      const d = await this.changerStore((data) => { data.paused = data.paused !== true; });
      return d.paused ? "Paused: reflect-mod no longer checks your messages." : "Resumed: short messages are checked again.";
    });
  }

  modifier(item, cx) {
    if (this.edition?.id === item.id) { this.edition = null; cx.notify(); return; }
    const etat = InputState.new({ placeholder: "The rule, rephrased" });
    etat.set_value(item.rule);
    etat.on("submit", (_e, cx) => this.enregistrer(item, item.scope, cx, etat.value()));
    this.edition = { id: item.id, etat };
    cx.notify();
  }

  // Les lignes de la section, sous son titre.
  elements(t, cx) {
    const items = this.store?.data?.items ?? [];
    const ici = (l) => l.scope === "global" || !this.racine || l.project === this.racine;
    const attente = items.filter((l) => l.status === "pending").sort((a, b) => (ici(b) - ici(a)) || b.count - a.count || b.lastAt - a.lastAt);
    const faites = items.filter((l) => l.status !== "pending").sort((a, b) => b.lastAt - a.lastAt);
    const pret = !this.occupe;
    const machine = this.machine ?? "This computer";

    const bouton = (id, texte, action, principal = false) => div().id(id).h(26).px(9).flex().items_center().rounded(7).text_size(12)
      .when(principal, (e) => e.bg(pret ? t.solid : t.raised).text_color(pret ? t.solid_foreground : t.dim))
      .when(!principal, (e) => e.border_1().border_color(t.border).text_color(pret ? t.muted : t.dim))
      .when(pret, (e) => e.cursor_pointer().hover((s) => (principal ? s : s.bg(t.hover))).on_click((_e, cx) => action(cx)))
      .child(texte);
    const champ = (etat, id, quoi) => div().id(id).flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8).border_1()
      .border_color(this.saisie === quoi ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(etat).h_full().text_size(12).text_color(t.foreground));
    const portee = (l) => (l.scope === "global" ? "Global" : `Repo · ${nomDossier(l.project)}`);
    const repli = (cle, texte) => h_flex().id(`rg-${cle}`).px(14).pt(8).pb(4).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.ouvert[cle] = !this.ouvert[cle]; cx.notify(); })
      .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(texte))
      .child(svg(`mods/files/chevron-${this.ouvert[cle] ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim));

    const carte = (l) => {
      const edite = this.edition?.id === l.id;
      return v_flex().id(`rg-r-${l.id}`).flex_none().mx(10).mb(8).p(10).gap(8).rounded(8).border_1().border_color(t.border)
        .when(!ici(l), (e) => e.opacity(0.75))
        .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
          .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).child(portee(l)))
          .when(l.count > 1, (e) => e.child(div().child(`×${l.count}`)))
          .child(div().flex_1())
          .child(div().child(dayMonth(new Date(l.lastAt)))))
        .when(!edite, (e) => e.child(div().text_size(13).child(l.rule)))
        .when(edite, (e) => e.child(h_flex().child(champ(this.edition.etat, `rg-e-${l.id}`, `e-${l.id}`))))
        .child(h_flex().gap(6).flex_wrap()
          .child(bouton(`rg-s-${l.id}`, l.scope === "project" ? "Save to ./CLAUDE.md" : "Save to ~/.claude/CLAUDE.md",
            (cx) => this.enregistrer(l, l.scope, cx, edite ? this.edition.etat.value() : undefined), true))
          .child(bouton(`rg-o-${l.id}`, l.scope === "project" ? "Global instead" : "This repo instead",
            (cx) => this.enregistrer(l, l.scope === "project" ? "global" : "project", cx, edite ? this.edition.etat.value() : undefined)))
          .child(bouton(`rg-m-${l.id}`, edite ? "Cancel" : "Edit", (cx) => this.modifier(l, cx)))
          .child(bouton(`rg-i-${l.id}`, "Ignore", (cx) => this.ignorer(l, cx))));
    };

    const ligneFaite = (l) => h_flex().id(`rg-h-${l.id}`).h(26).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
      .hover((s) => s.bg(t.hover)).tooltip(`${l.rule}\n${portee(l)} · ${l.status === "saved" ? "saved" : "ignored"}`)
      .child(div().w(70).flex_none().text_size(11).text_color(l.status === "saved" ? t.foreground : t.dim)
        .child(l.status === "saved" ? "saved" : "ignored"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(l.status === "saved" ? t.foreground : t.muted).child(l.rule));

    const out = [];
    if (this.store?.plugin === false) out.push(div().mx(14).pb(6).text_size(12).text_color(t.dim)
      .child(`The reflect-mod plugin isn't enabled on ${machine}: nothing new will show up here.`));
    out.push(...attente.map(carte));
    if (!attente.length) out.push(div().mx(14).h(24).text_size(12).text_color(t.dim)
      .child(this.store ? `No pending rules · ${machine}` : this.erreur ? "" : "Reading the store…"));
    if (this.erreur) out.push(div().mx(14).pb(4).text_size(11.5).text_color(t.ansi1).child(this.erreur));
    if (this.note) out.push(div().mx(14).pb(4).text_size(11.5).text_color(t.dim).child(this.note));
    out.push(repli("ajouter", "Add a rule"));
    if (this.ouvert.ajouter) out.push(v_flex().flex_none().mx(14).gap(8)
      .child(h_flex().child(champ(this.nouvelle, "rg-nouvelle", "nouvelle")))
      .child(h_flex().gap(6).flex_wrap()
        .child(bouton("rg-n-global", "Add to ~/.claude/CLAUDE.md", (cx) => this.ajouter("global", cx)))
        .child(bouton("rg-n-projet", "Add to ./CLAUDE.md", (cx) => this.ajouter("project", cx)))));
    if (faites.length) {
      out.push(repli("decidees", `Decided · ${faites.length}`));
      if (this.ouvert.decidees) out.push(...faites.slice(0, 80).map(ligneFaite));
    }
    return out;
  }
}

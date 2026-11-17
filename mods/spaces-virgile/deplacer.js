// Déplacer un onglet vers un autre space de la même machine. herdr-app n'a pas de commande pour ça :
// tab.move reste dans le space de l'onglet. On passe donc par les étiquettes du core, comme le
// décrit AGENTS.md (« A terminal with those labels shows up there »).
//   1. terminal.park sur chaque terminal qui a un volet dans l'onglet : le volet part, avec lui les
//      étiquettes herdr.space et herdr.tab, et l'onglet vidé disparaît. Le programme tourne toujours.
//   2. hc label herdr.space=<cible> herdr.tab=<nouvel id> : Herdr adopte ces terminaux dans un nouvel
//      onglet du space cible (un id d'onglet inconnu devient un onglet), sans changer ce qui est affiché,
//      et remet keep.
//   3. tab.rename rend son nom à l'onglet, s'il en avait un.
// Les sous-agents suivent leur parent (ils n'ont pas d'étiquettes d'onglet).
// Un onglet en Trace (un volet de chat, et l'agent parqué derrière avec herdr.chat=<volet>) :
// l'agent est adopté de même, son lien herdr.chat retiré. Le volet de chat n'est fermé qu'une fois
// l'agent dans son nouvel onglet : sinon le balayage de parked.js tuerait un agent sans volet ni chat.
// Puis Trace est rouvert dans le nouvel onglet, comme le fait l'interrupteur de pane-chat, et keep remis.
// Ce qui ne suit pas : la disposition exacte des découpes (les volets sont remis côte à côte) et les
// volets de mods autres que le chat, qui restent dans l'ancien onglet.
// Testé le 2026-11-16 à la main (park, label, adoption, rename) sur des spaces jetables.
import { exec, hc, run, spaces, panes, terminals, shared, setShared } from "herdr";

const local = (id) => String(id).split("/").pop();
const hex = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const CHAT = "chat";

// Une commande de l'app, attendue (les étapes doivent se suivre), comme pane-chat.
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, JSON.stringify(args)]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || (r.stderr || "").trim() || `${name} a échoué`);
  return out;
}

async function labels(addr) {
  try { return JSON.parse((await hc(["get", addr, "--json"])).stdout || "{}").labels ?? {}; } catch { return null; }
}

// Attend que test() soit vrai, au plus `ms`.
async function until(cx, test, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await test()) return true;
    await cx.sleep(250);
  }
  return Boolean(await test());
}

// Où un onglet peut aller : les autres spaces de sa machine (un terminal reste sur la machine
// qui le fait tourner).
export function targetsFor(tabId) {
  const all = spaces();
  const from = all.find((s) => (s.tabs ?? []).some((c) => c.id === tabId));
  if (!from) return [];
  return all.filter((s) => s.id !== from.id && (s.machine ?? null) === (from.machine ?? null));
}

// Rend { error } (rien n'a bougé, ou pas tout), ou { id } : l'id du nouvel onglet ; avec un
// avertissement `error` si seul Trace n'a pas pu être rouvert.
export async function moveTab(cx, tabId, toSpaceId) {
  const fail = (error) => ({ error });
  const all = spaces();
  const from = all.find((s) => (s.tabs ?? []).some((c) => c.id === tabId));
  const to = all.find((s) => s.id === toSpaceId);
  if (!from || !to) return fail("Cet onglet ou ce space n'existe plus.");
  if (from.id === to.id) return { id: tabId };
  if ((from.machine ?? null) !== (to.machine ?? null)) return fail("Un onglet ne peut aller que dans un space de la même machine.");
  const tab = from.tabs.find((c) => c.id === tabId);
  const ps = panes().filter((p) => p.tab === tabId);
  const own = ps.filter((p) => p.terminal).map((p) => p.terminal);
  const chats = ps.filter((p) => p.mod === CHAT)
    .map((p) => ({ pane: p.pane, agent: terminals().find((k) => k.state === "live" && k.labels?.["herdr.chat"] === p.pane)?.address }))
    .filter((c) => c.agent);
  if (!own.length && !chats.length) return fail("Cet onglet n'a pas de terminal à déplacer.");

  // 1. Les terminaux avec un volet : parqués, puis attendus (la commande répond avant que le core l'ait fait).
  for (const a of own) await app("terminal.park", { terminal: a });
  const parked = await until(cx, async () => {
    for (const a of own) { const l = await labels(a); if (l === null || l["herdr.tab"]) return false; }
    return true;
  });
  if (!parked) return fail("Les terminaux n'ont pas quitté leur onglet à temps. Rien d'autre n'a été changé.");

  // 2. Tous dans un nouvel onglet du space cible.
  const tid = hex();
  for (const a of own) await hc(["label", a, `herdr.space=${local(to.id)}`, `herdr.tab=tb${tid}`]);
  for (const c of chats) await hc(["label", c.agent, `herdr.space=${local(to.id)}`, `herdr.tab=tb${tid}`, "herdr.chat="]);
  const newId = `${to.machine ? `${to.machine}/` : ""}tb${tid}`;
  const moved = [...own, ...chats.map((c) => c.agent)];
  const adopted = await until(cx, () => moved.every((a) => panes().some((p) => p.tab === newId && p.terminal === a)));
  if (!adopted) return fail("Les terminaux sont étiquetés pour le space cible, mais Herdr ne les y a pas encore montrés.");

  // 3. Son nom, les volets de chat d'avant fermés (leurs agents ont maintenant leur volet), Trace rouvert.
  if (tab?.named && tab.name) run("tab.rename", { id: newId, name: tab.name });
  for (const c of chats) run("pane.close", { pane: c.pane });
  let traceFailed = 0;
  for (const c of chats) {
    try {
      const p = panes().find((x) => x.terminal === c.agent);
      const out = await app("pane.split", { direction: "right", pane: p.pane, mod: CHAT, props: { terminal: c.agent, look: "trace" } });
      if (!out.pane) throw new Error("pas de volet");
      setShared("chat.look", { ...(shared("chat.look") ?? {}), [out.pane]: "trace", last: "trace" });
      await hc(["label", c.agent, `herdr.chat=${out.pane}`]);
      await app("terminal.park", { terminal: c.agent });
      // Parquer coupe keep : remis une fois le parcage fait (comme un agent en Trace l'a), pour qu'il
      // survive à un core perdu.
      await until(cx, async () => { const l = await labels(c.agent); return l !== null && !l["herdr.tab"]; });
      await hc(["keep", c.agent]);
    } catch { traceFailed++; }
  }
  return { id: newId, error: traceFailed ? "Onglet déplacé, mais Trace n'a pas pu être rouvert : l'agent est affiché en Terminal." : null };
}

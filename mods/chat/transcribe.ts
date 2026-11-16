// Dictation's writer (mods/chat dictate.js): sends record.ts's recording to a Whisper server (an OpenAI-style
// /v1/audio/transcriptions, such as faster-whisper's) and prints one JSON line: { text } or { error } in plain words.
//   bun transcribe.ts <recording.wav>
// The server is this machine's <app home>/data/whisper.json: { "url": "<…/v1/audio/transcriptions>",
// "language"?: "fr" } (no language: Whisper finds it from the audio). No key: keep the server on a private network.
import { join } from "node:path";

const HOME = process.env.HERDR_APP_HOME || join(process.env.HOME ?? "", ".config/herdr-app");
const CONFIG = join(HOME, "data", "whisper.json");
const MAX_AUDIO = 20 * 1024 * 1024;

async function server(): Promise<{ url: string; language: string }> {
  const c = await Bun.file(CONFIG).json().catch(() => null);
  const url = typeof c?.url === "string" ? c.url.trim() : "";
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error(`Dictation needs a Whisper server: put its address in ${CONFIG} as { "url": "…" }.`);
  return { url, language: typeof c?.language === "string" ? c.language.trim() : "" };
}

// Why the microphone gave nothing: the recorder's last words (record.ts keeps them beside the recording).
async function nothingRecorded(file: string): Promise<never> {
  const log = await Bun.file(`${file}.log`).text().catch(() => "");
  const last = log.trim().split("\n").pop()?.trim().slice(0, 160);
  throw new Error(last ? `The microphone didn't start: ${last}` : "Nothing was recorded.");
}

async function transcribe(file: string): Promise<string> {
  const f = Bun.file(file);
  if (!(await f.exists()) || f.size <= 44) return nothingRecorded(file);
  if (f.size > MAX_AUDIO) throw new Error("That recording is too long.");
  const { url, language } = await server();
  const form = new FormData();
  form.append("file", new Blob([await f.arrayBuffer()], { type: "audio/wav" }), "dictation.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const host = new URL(url).host;
  let r: Response;
  try { r = await fetch(url, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(120000) }); }
  catch (e: any) {
    throw new Error(e?.name === "TimeoutError" ? `Whisper (${host}) didn't answer in time. Try again.`
      : `Can't reach Whisper at ${host}. Is it on, and its network up?`);
  }
  const body = await r.text().catch(() => "");
  if (!r.ok) {
    let why: unknown = "";
    try { why = JSON.parse(body)?.detail; } catch {}
    throw new Error(`Whisper said ${r.status}${typeof why === "string" && why ? `: ${why.slice(0, 200)}` : "."}`);
  }
  let text: unknown;
  try { text = JSON.parse(body)?.text; } catch {}
  if (typeof text !== "string") throw new Error("Whisper gave no words back.");
  return text.replace(/\s+/g, " ").trim();
}

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: bun transcribe.ts <recording.wav>"); process.exit(2); }
try {
  console.log(JSON.stringify({ text: await transcribe(file) }));
} catch (e: any) {
  console.log(JSON.stringify({ error: String(e?.message ?? e) }));
}

// Type-only import: keeps the module out of the static dep graph until we
// actually pick a variant via dynamic import().
import type { Translator as TranslatorType, Availability } from "@accountdesk/translator";

type TranslatorMod = typeof import("@accountdesk/translator");

// 18 bidirectional pairs in the WASM manifest.
// Every language tag that appears in the WASM manifest. Sorted alphabetically
// for the dropdown — `availability()` decides if a chosen pair is reachable.
const LANGS = [
  "af",
  "ar",
  "cs",
  "da",
  "de",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "ro",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "xh",
  "zh",
];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const srcSel = $<HTMLSelectElement>("src");
const tgtSel = $<HTMLSelectElement>("tgt");
const statusBtn = $<HTMLButtonElement>("btn-status");
const statusPill = $<HTMLSpanElement>("status-pill");
const createBtn = $<HTMLButtonElement>("btn-create");
const destroyBtn = $<HTMLButtonElement>("btn-destroy");
const lifecyclePill = $<HTMLSpanElement>("lifecycle-pill");
const progress = $<HTMLProgressElement>("progress");
const progressText = $<HTMLSpanElement>("progress-text");
const inputArea = $<HTMLTextAreaElement>("input");
const outputArea = $<HTMLTextAreaElement>("output");
const translateBtn = $<HTMLButtonElement>("btn-translate");
const streamBtn = $<HTMLButtonElement>("btn-stream");
const measureBtn = $<HTMLButtonElement>("btn-measure");
const abortBtn = $<HTMLButtonElement>("btn-abort");
const logPre = $<HTMLPreElement>("log");

for (const l of LANGS) {
  srcSel.append(new Option(l, l, l === "en", l === "en"));
  tgtSel.append(new Option(l, l, l === "de", l === "de"));
}

let translator: TranslatorType | undefined;
let currentAbort: AbortController | undefined;

function log(line: string, cls?: "ok" | "warn" | "err"): void {
  const ts = new Date().toLocaleTimeString();
  const span = document.createElement("span");
  span.textContent = `[${ts}] ${line}\n`;
  if (cls) span.className = cls;
  logPre.append(span);
  logPre.scrollTop = logPre.scrollHeight;
}

function pickVariant(): "lean" | "bundle" {
  const checked = document.querySelector<HTMLInputElement>('input[name="variant"]:checked');
  return (checked?.value ?? "lean") as "lean" | "bundle";
}

async function loadVariant(variant: "lean" | "bundle"): Promise<TranslatorMod> {
  if (variant === "bundle") {
    return import("@accountdesk/translator/bundle") as Promise<TranslatorMod>;
  }
  return import("@accountdesk/translator");
}

function setLifecycle(state: string, cls?: "ok" | "warn" | "err"): void {
  lifecyclePill.textContent = state;
  lifecyclePill.className = `pill ${cls ?? ""}`;
}

statusBtn.addEventListener("click", async () => {
  statusPill.textContent = "checking…";
  try {
    const mod = await loadVariant(pickVariant());
    const status: Availability = await mod.Translator.availability({
      sourceLanguage: srcSel.value,
      targetLanguage: tgtSel.value,
    });
    statusPill.textContent = status;
    statusPill.className = `pill ${status === "unavailable" ? "err" : "ok"}`;
    log(`availability(${srcSel.value} → ${tgtSel.value}) = ${status}`);
  } catch (err) {
    statusPill.textContent = "error";
    statusPill.className = "pill err";
    log(`availability error: ${(err as Error).message}`, "err");
  }
});

createBtn.addEventListener("click", async () => {
  if (translator) {
    log("destroy() previous translator first", "warn");
    return;
  }
  setLifecycle("creating…", "warn");
  progress.hidden = false;
  progress.value = 0;
  progressText.textContent = "0 %";
  const t0 = performance.now();
  try {
    const mod = await loadVariant(pickVariant());
    translator = await mod.Translator.create({
      sourceLanguage: srcSel.value,
      targetLanguage: tgtSel.value,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          progress.value = e.loaded;
          progressText.textContent = `${(e.loaded * 100).toFixed(1)} %`;
        });
      },
    });
    const dt = (performance.now() - t0).toFixed(0);
    setLifecycle("ready", "ok");
    log(`create({${srcSel.value} → ${tgtSel.value}}, variant=${pickVariant()}) in ${dt} ms`, "ok");
    progress.hidden = true;
    progressText.textContent = "";
    destroyBtn.disabled = false;
    translateBtn.disabled = false;
    streamBtn.disabled = false;
    measureBtn.disabled = false;
  } catch (err) {
    progress.hidden = true;
    progressText.textContent = "";
    setLifecycle("create failed", "err");
    log(`create error: ${(err as Error).name} — ${(err as Error).message}`, "err");
  }
});

destroyBtn.addEventListener("click", () => {
  if (!translator) return;
  translator.destroy();
  translator = undefined;
  setLifecycle("destroyed", "warn");
  destroyBtn.disabled = true;
  translateBtn.disabled = true;
  streamBtn.disabled = true;
  measureBtn.disabled = true;
  log("destroy()");
});

translateBtn.addEventListener("click", async () => {
  if (!translator) return;
  outputArea.value = "";
  currentAbort = new AbortController();
  abortBtn.disabled = false;
  const t0 = performance.now();
  try {
    const out = await translator.translate(inputArea.value, { signal: currentAbort.signal });
    const dt = (performance.now() - t0).toFixed(0);
    outputArea.value = out;
    log(`translate(${inputArea.value.length} chars) in ${dt} ms`, "ok");
  } catch (err) {
    log(`translate error: ${(err as Error).name} — ${(err as Error).message}`, "err");
  } finally {
    abortBtn.disabled = true;
    currentAbort = undefined;
  }
});

streamBtn.addEventListener("click", async () => {
  if (!translator) return;
  outputArea.value = "";
  currentAbort = new AbortController();
  abortBtn.disabled = false;
  const t0 = performance.now();
  try {
    const stream = translator.translateStreaming(inputArea.value, {
      signal: currentAbort.signal,
    });
    for await (const chunk of stream as unknown as AsyncIterable<string>) {
      outputArea.value += (outputArea.value ? " " : "") + chunk;
    }
    const dt = (performance.now() - t0).toFixed(0);
    log(`translateStreaming(${inputArea.value.length} chars) in ${dt} ms`, "ok");
  } catch (err) {
    log(`stream error: ${(err as Error).name} — ${(err as Error).message}`, "err");
  } finally {
    abortBtn.disabled = true;
    currentAbort = undefined;
  }
});

measureBtn.addEventListener("click", async () => {
  if (!translator) return;
  try {
    const tokens = await translator.measureInputUsage(inputArea.value);
    log(`measureInputUsage = ${tokens} tokens (quota ${translator.inputQuota})`);
  } catch (err) {
    log(`measure error: ${(err as Error).message}`, "err");
  }
});

abortBtn.addEventListener("click", () => {
  currentAbort?.abort();
  abortBtn.disabled = true;
  log("abort()", "warn");
});

setLifecycle("idle");
log("Playground ready. Pick a variant + pair, then Create.");

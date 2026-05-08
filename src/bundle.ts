import { setDefaultWasmWorkerFactory } from "./backends/WasmBackend.ts";

// The string below is a placeholder. `scripts/postbuild.mjs` replaces this
// single occurrence with a base64-encoded copy of `dist/worker.js` after
// `vp pack` finishes. The literal must appear exactly once in the source
// (and once in the build output) for the postbuild step's sanity check.
const WORKER_B64 = "__INLINE_WORKER_BASE64__";

setDefaultWasmWorkerFactory(() => {
  const code = atob(WORKER_B64);
  const blob = new Blob([code], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob), { type: "module" });
});

export { Translator } from "./Translator.ts";
export { DownloadProgressEvent } from "./monitor.ts";
export type {
  Availability,
  CreateMonitor,
  CreateMonitorCallback,
  DownloadProgressEventInit,
  TranslateOptions,
  TranslatorCreateOptions,
  TranslatorOptions,
} from "./types.ts";

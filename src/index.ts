import { setDefaultWasmWorkerFactory } from "./backends/WasmBackend.ts";

// Static `new URL(..., import.meta.url)` literal — Vite, Webpack 5, esbuild,
// and Rollup all detect this exact pattern and emit the worker file as a
// chunk in the consumer's build. Consumers using a bundler that can't pattern
// match this (or who want full inlining) can use `@accountdesk/translator/bundle`
// instead, which carries the worker as base64 inside the main module.
setDefaultWasmWorkerFactory(
  () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
);

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

# @accountdesk/translator

A drop-in polyfill for the [MDN Translator API](https://developer.mozilla.org/en-US/docs/Web/API/Translator) that automatically picks the best available backend:

1. **Native** — `window.Translator` on Chromium-based browsers (Chrome, Edge, Opera, Brave).
2. **WASM** — on-device inference via [Transformers.js](https://huggingface.co/docs/transformers.js) and Helsinki-NLP MarianMT models for everyone else (Firefox, Safari, iOS WebView).

The public surface mirrors the MDN spec, so consumers don't have to know which backend is running.

```ts
import { Translator } from "@accountdesk/translator";

const translator = await Translator.create({
  sourceLanguage: "en",
  targetLanguage: "de",
});
const greeting = await translator.translate("Hello world");
translator.destroy();
```

## Install

```bash
pnpm add @accountdesk/translator
```

## Two ways to consume the library

The library ships in two flavors. Pick whichever fits your bundler / deployment story:

### `@accountdesk/translator` (default, lean — ~2 KB gzipped)

Uses a static `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })` literal that Vite, Webpack 5, esbuild, and Rollup detect and emit as a chunk in your build. The worker (with Transformers.js + onnxruntime-web inlined) ships next to your app's JS and is fetched only when a translation actually happens.

```ts
import { Translator } from "@accountdesk/translator";
```

### `@accountdesk/translator/bundle` (all-in-one — ~150 KB gzipped, lazy-friendly)

Carries the worker as a base64-encoded string inside the main module and spawns it from a `Blob`-URL at runtime. No `new URL(...)` magic — works in any bundler without configuration.

```ts
// Pay nothing on the native code path; load the WASM fallback only when needed.
const status = await (await import("@accountdesk/translator")).Translator.availability(opts);
if (status === "unavailable") {
  const { Translator } = await import("@accountdesk/translator/bundle");
  // ...
}
```

The `bundle` entry is best paired with a dynamic `import()` so users on Chromium (where the native API is available) never download it.

### Bring your own worker

Both entries accept an optional `worker` factory in `Translator.create`. Useful for shared workers, pre-warmed pools, or fully custom worker URLs:

```ts
import myWorkerUrl from "./my-worker.js?worker&url";

const translator = await Translator.create({
  sourceLanguage: "en",
  targetLanguage: "de",
  worker: () => new Worker(myWorkerUrl, { type: "module" }),
});
```

## API

The full surface is a 1:1 mirror of the MDN Translator spec.

```ts
type Availability = "unavailable" | "downloadable" | "downloading" | "available";

class Translator {
  static availability(opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<Availability>;
  static create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: CreateMonitor) => void;
    signal?: AbortSignal;
    worker?: () => Worker; // optional override (WASM path only)
  }): Promise<Translator>;

  readonly inputQuota: number;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;

  translate(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming(input: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  measureInputUsage(input: string): Promise<number>;
  destroy(): void;
}
```

### Backend selection

`availability()` is the union of every backend (priority `available > downloading > downloadable > unavailable`). `create()` always picks the native backend if it isn't `unavailable` for the requested pair, and falls back to WASM otherwise.

The native path requires user activation (transient activation) for `create()` per the spec. The WASM path doesn't, but call `create()` from a user gesture anyway for consistency.

### Download progress

```ts
const translator = await Translator.create({
  sourceLanguage: "en",
  targetLanguage: "de",
  monitor(m) {
    m.addEventListener("downloadprogress", (e) => {
      console.log(`Download: ${(e.loaded * 100).toFixed(1)}%`);
    });
  },
});
```

Progress events surface for both backends — native via the platform's monitor, WASM via Transformers.js' `progress_callback`.

## Supported language pairs (WASM backend)

Every Helsinki-NLP single-pair model on the Xenova org is wired up — 67 models total, drawn from the [HF Hub](https://huggingface.co/Xenova).

**English bridges (20 pairs, both directions):**
`af`, `ar`, `cs`, `da`, `de`, `es`, `fi`, `fr`, `hi`, `hu`, `id`, `it`, `ja`, `nl`, `ru`, `sv`, `uk`, `vi`, `xh`, `zh` — each pair available `en↔X`.

**Direct non-English bridges (8 pairs, both directions):** `de↔fr`, `es↔de`, `es↔fr`, `es↔it`, `es↔ru`, `fr↔ro`, `ru↔fr`, `ru↔uk`. These avoid the round-trip-through-English quality loss.

**One-way only (11 pairs):** `da→de`, `et→en`, `fi→de`, `it→fr`, `ko→en`, `nl→fr`, `no→de`, `pl→en`, `th→en`, `tr→en`, `en→ro`. The reverse direction returns `'unavailable'` because no upstream model exists.

### Pivot translation through English

For any pair where no direct model exists but both halves of an English bridge are available (e.g. `de→zh`, `fr→hi`, `es→ja`), the library transparently routes through English:

```
Translator.create({ sourceLanguage: "de", targetLanguage: "zh" })
   ↓
   spawns two workers in parallel
   loads de→en in one, en→zh in the other
   translate("Hallo Welt") = en→zh(de→en("Hallo Welt"))
```

Both models download in parallel, so first-translation latency is bounded by the slower of the two downloads, not their sum. The combined download progress reports a single monotonic 0..1 value to your `monitor` listener.

This expands the catalog from 67 direct pairs to **several hundred reachable pairs** without any consumer code changes — `Translator.availability()` returns `'downloadable'` for every pivot path that resolves.

**Trade-offs of pivot:**

- **Memory:** two pipelines loaded at once (~420 MB fp16). On low-memory devices, prefer pairs with a direct model.
- **Latency:** two sequential inference calls per translation, ~2× the cost of a direct path. Negligible for short messaging text.
- **Quality:** ~85-90 % of direct-pair quality. Idiomatic phrasing and complex syntax can drift across the pivot. Direct pairs always win when both exist.

Each fp16 model is ~210 MB (encoder + merged decoder), cached in the browser's Cache Storage (`transformers-cache`) after the first download. Subsequent `create()` calls with the same pair are instant.

The native path is not bound by this manifest — Chromium's built-in translator advertises its own set of pairs.

## Browser support

|               | Chromium (Chrome, Edge, …) | Firefox | Safari (desktop) | Safari (iOS) |
| ------------- | -------------------------- | ------- | ---------------- | ------------ |
| Native        | ✅                         | ❌      | ❌               | ❌           |
| WASM fallback | ✅                         | ✅      | ✅               | ✅           |

Translation always runs in a Web Worker so the main thread stays responsive.

## Errors

`DOMException` instances with the same `name` as the spec:

| When                                   | `error.name`        |
| -------------------------------------- | ------------------- |
| No backend supports the pair           | `NotSupportedError` |
| Use after `destroy()`                  | `InvalidStateError` |
| Permissions-Policy blocks `Translator` | `NotAllowedError`   |
| `AbortSignal` aborted                  | `AbortError`        |
| Worker died unexpectedly               | `OperationError`    |
| Model download failed                  | `NetworkError`      |

## Development

This package is built with [Vite+](https://viteplus.dev) (`vp` CLI).

```bash
vp install         # install dependencies
vp check           # lint, format, type-check
vp test            # run unit tests
pnpm run build     # `vp pack` + postbuild step that inlines the worker into bundle.js
```

The build emits three top-level entries plus a small shared chunk into `dist/`:

```
dist/index.js          — lean entry (default)
dist/bundle.js         — all-in-one entry with inlined worker
dist/worker.js         — the inference worker (used by the lean entry)
dist/Translator-*.js   — shared Translator/backend logic (loaded automatically)
```

## Licenses & attribution — read this before shipping

The library code is MIT, but **the translation models you load at runtime are not** — they have their own licenses and impose obligations on every product that uses them. This applies to commercial _and_ internal apps.

### What ships when you use this library

| Component                                                                | License                                                   | Where it lives                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `@accountdesk/translator` (this package)                                 | MIT                                                       | The JS you import                                                                |
| [Transformers.js](https://github.com/huggingface/transformers.js)        | Apache-2.0, © Hugging Face                                | Bundled into `worker.js` / `bundle.js`                                           |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)             | MIT, © Microsoft                                          | Bundled into `worker.js` / `bundle.js`                                           |
| [Helsinki-NLP / Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) models | **mostly CC-BY 4.0**, some Apache-2.0 — _check each card_ | Downloaded at runtime from the Hugging Face Hub, cached in browser Cache Storage |

### What CC-BY 4.0 means in practice

Most Helsinki-NLP MarianMT models on the Hub are released under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). The license _permits_ commercial use, redistribution, modification (including the q8 quantization done by [Xenova](https://huggingface.co/Xenova)), and offline / on-device inference — which is exactly what this library does. **In return it requires attribution.**

Concretely, a product that ships this library must:

1. **Credit the model authors visibly** somewhere a reasonable user can find — an "About", "Credits", "Open-source notices", or "Settings → Legal" page is typical. The credit should name the model (e.g. _Helsinki-NLP/opus-mt-en-de_), the authors (Tatoeba Translation Challenge / Helsinki-NLP / University of Helsinki), and link to the model's page on the Hugging Face Hub.
2. **State that the model is licensed CC-BY 4.0**, ideally with a link to the license text.
3. **Indicate any modifications**. The Xenova-quantized versions are modifications, so a note like _"quantized to int8 by Xenova"_ satisfies this.
4. **Not imply endorsement** by the original authors of your product.

A drop-in attribution block you can paste into your "Open-source notices" page:

> Translation by [Helsinki-NLP / Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) — Tiedemann, J. (2020). _The Tatoeba Translation Challenge._ Models distributed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/), int8-quantized for browser inference by [Xenova](https://huggingface.co/Xenova).
>
> Powered by [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0, © Hugging Face) and [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT, © Microsoft).

### Other things to keep in mind

- **Per-model licenses can differ.** A small number of Opus-MT cards specify Apache-2.0 instead of CC-BY 4.0. Always check the model card on the Hub before relying on a specific pair.
- **No warranty.** All upstream licenses disclaim warranty, including translation quality, fitness for purpose, and any liability for offensive or incorrect output. Don't ship machine-translated text into safety- or compliance-critical contexts without human review.
- **Privacy is straightforward** because inference happens on-device — the user's text never leaves the browser. There's no data-processing addendum to negotiate.
- **The native `window.Translator` path** is governed by the user's browser license, not by anything above. No attribution is required for that path.

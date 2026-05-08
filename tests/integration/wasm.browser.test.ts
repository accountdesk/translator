// Real-browser smoke tests for the WASM backend. These run against the built
// dist/ — they import the package by name and rely on pnpm's workspace symlink
// + the package.json `exports` map. Run with:
//   pnpm run build
//   pnpm exec vp test --project browser
//
// First execution downloads ~210 MB of fp16 model weights from huggingface.co
// (cached in IndexedDB after that), so individual tests use long timeouts.
//
// Why these tests exist: pure Node tests can't see onnxruntime-web crashes
// during pipeline construction, worker URL resolution failures, the postbuild
// base64-inlined worker, or anything else that's fundamentally browser-only.
// We learned this the hard way with the `MatMulNBits Missing required scale`
// (q8) and `SimplifiedLayerNormFusion ... InsertedPrecisionFreeCast_*` (fp16)
// crashes during model load — both manifested only at runtime in a real
// browser. This suite is the regression net.

import { describe, expect, test } from "vite-plus/test";
// Import the published artifacts directly so we exercise the real built code
// (postbuild-inlined base64 worker for `bundle.js`, static-URL worker for
// `index.js`) instead of the TS source.
import { Translator as BundleTranslator } from "../../dist/bundle.js";
import { Translator as LeanTranslator } from "../../dist/index.js";

// One representative pair per backend variant — exercises the actual onnx
// runtime pipeline construction, which is where the q8 / fp16 crashes lived.
const PAIR = { sourceLanguage: "en", targetLanguage: "de" } as const;

describe("WasmBackend (bundle variant — base64-inlined worker)", () => {
  test("loads the model, translates en→de, then destroys cleanly", async () => {
    const translator = await BundleTranslator.create(PAIR);
    try {
      const out = await translator.translate("Hello world");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      expect(out.toLowerCase()).toMatch(/welt|hallo/);
    } finally {
      translator.destroy();
    }
  }, 180_000);

  test("after destroy(), translate() rejects with InvalidStateError", async () => {
    const translator = await BundleTranslator.create(PAIR);
    translator.destroy();
    await expect(translator.translate("Hello")).rejects.toMatchObject({
      name: "InvalidStateError",
    });
  }, 180_000);
});

describe("WasmBackend (lean variant — static-URL worker)", () => {
  test("loads the model, translates en→de, then destroys cleanly", async () => {
    // Same exercise as above, but spawning the worker via the static
    // `new URL(..., import.meta.url)` literal. If Vite's worker-pattern
    // detection or our path-flip logic regresses, this fails.
    const translator = await LeanTranslator.create(PAIR);
    try {
      const out = await translator.translate("Hello world");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      expect(out.toLowerCase()).toMatch(/welt|hallo/);
    } finally {
      translator.destroy();
    }
  }, 180_000);

  test("translateStreaming yields one chunk per sentence", async () => {
    const translator = await LeanTranslator.create(PAIR);
    try {
      const stream = translator.translateStreaming("Hello world. How are you?");
      const chunks: string[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<string>) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(2);
      expect(chunks.every((c) => c.length > 0)).toBe(true);
    } finally {
      translator.destroy();
    }
  }, 180_000);

  test("measureInputUsage returns a positive token count", async () => {
    const translator = await LeanTranslator.create(PAIR);
    try {
      const tokens = await translator.measureInputUsage("Hello world");
      expect(tokens).toBeGreaterThan(0);
    } finally {
      translator.destroy();
    }
  }, 180_000);
});

describe("PivotBackend (de → zh via English)", () => {
  test("loads both hops in parallel and translates", async () => {
    // No direct de→zh model exists. The backend must spawn both
    // de→en and en→zh, then chain them. This catches regressions in
    // the worker-pool, parallel loading, or error propagation across
    // the hop boundary.
    const translator = await LeanTranslator.create({
      sourceLanguage: "de",
      targetLanguage: "zh",
    });
    try {
      const out = await translator.translate("Hallo Welt");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    } finally {
      translator.destroy();
    }
  }, 240_000);
});

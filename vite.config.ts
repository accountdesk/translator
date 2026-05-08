import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    // Three entry points produce three output files:
    //  - dist/index.js   — lean, default (`@accountdesk/translator`)
    //  - dist/bundle.js  — all-in-one with inlined base64 worker (`./bundle`)
    //  - dist/worker.js  — the translation worker (`./worker`, also embedded
    //                      into bundle.js by the postbuild script)
    entry: ["src/index.ts", "src/bundle.ts", "src/worker.ts"],
    format: ["esm"],
    dts: {
      tsgo: true,
    },
    // Browser platform: pick @huggingface/transformers' web entry (the
    // package.json `exports` map otherwise prefers the node entry, which
    // would drag in onnxruntime-node, sharp, etc.).
    platform: "browser",
    minify: true,
    // Force-bundle Transformers.js. tsdown keeps `dependencies` external by
    // default; we override that so the worker chunk is fully self-contained
    // and consumers don't have to install Transformers.js separately. Only
    // the worker actually imports Transformers.js, so the main and lean
    // entries stay small.
    deps: {
      alwaysBundle: ["@huggingface/transformers"],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    // Two projects so day-to-day `vp test` stays fast (Node-mode units only)
    // while a separate `vp test --project browser` exercises the real WASM
    // pipeline against the built dist/. The browser project catches issues
    // that pure Node tests can never see — onnxruntime-web crashes, worker
    // URL resolution, postbuild-inlined base64 worker, etc.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["tests/integration/**/*.test.ts"],
          // vite-plus's exposed types narrow `provider` more strictly than
          // the underlying Vitest schema; cast through `any` so the literal
          // string passes type-check while still reaching the Vitest runner
          // unmodified.
          browser: {
            enabled: true,
            provider: "playwright" as never,
            instances: [{ browser: "chromium" }],
            headless: true,
          },
          testTimeout: 180_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

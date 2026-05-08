import { describe, expect, test } from "vite-plus/test";
import { MANIFEST } from "../../src/backends/modelManifest.ts";
import { WasmBackend } from "../../src/backends/WasmBackend.ts";

describe("availability — every manifest entry resolves to 'downloadable'", () => {
  for (const entry of MANIFEST) {
    test(`${entry.source} → ${entry.target}`, async () => {
      expect(
        await WasmBackend.availability({
          sourceLanguage: entry.source,
          targetLanguage: entry.target,
        }),
      ).toBe("downloadable");
    });
  }
});

test("availability normalizes BCP 47 region/script subtags", async () => {
  expect(await WasmBackend.availability({ sourceLanguage: "en-US", targetLanguage: "de-DE" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "EN", targetLanguage: "DE" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "zh-Hans", targetLanguage: "en" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "pt_BR", targetLanguage: "en" })).toBe(
    "unavailable", // pt is not in the manifest
  );
});

test("availability returns 'unavailable' only when neither direct nor pivot path exists", async () => {
  // No Helsinki-NLP model on the Hub at all for these.
  expect(await WasmBackend.availability({ sourceLanguage: "en", targetLanguage: "el" })).toBe(
    "unavailable",
  );
  // ja→ko: would need an en→ko hop, which doesn't exist on the Hub.
  expect(await WasmBackend.availability({ sourceLanguage: "ja", targetLanguage: "ko" })).toBe(
    "unavailable",
  );
});

test("availability surfaces 'downloadable' for pivot-via-English pairs", async () => {
  // No direct de→zh / de→ja, but both en hops exist → pivot is reachable.
  expect(await WasmBackend.availability({ sourceLanguage: "de", targetLanguage: "zh" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "de", targetLanguage: "ja" })).toBe(
    "downloadable",
  );
  // en→pl is missing on the Hub, so de→pl can't pivot.
  expect(await WasmBackend.availability({ sourceLanguage: "de", targetLanguage: "pl" })).toBe(
    "unavailable",
  );
});

test("non-English direct bridges are reachable (e.g. Spanish ↔ German)", async () => {
  // Bidirectional non-en pairs avoid pivot-through-English quality loss.
  expect(await WasmBackend.availability({ sourceLanguage: "es", targetLanguage: "de" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "de", targetLanguage: "es" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "fr", targetLanguage: "ru" })).toBe(
    "downloadable",
  );
});

test("unidirectional pairs surface only the supported direction", async () => {
  // Polish: pl→en exists on the Hub, en→pl does not.
  expect(await WasmBackend.availability({ sourceLanguage: "pl", targetLanguage: "en" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "en", targetLanguage: "pl" })).toBe(
    "unavailable",
  );

  // Korean, Turkish, Thai — same shape.
  expect(await WasmBackend.availability({ sourceLanguage: "ko", targetLanguage: "en" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "tr", targetLanguage: "en" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "th", targetLanguage: "en" })).toBe(
    "downloadable",
  );

  // Romanian: only en→ro published, not the reverse.
  expect(await WasmBackend.availability({ sourceLanguage: "en", targetLanguage: "ro" })).toBe(
    "downloadable",
  );
  expect(await WasmBackend.availability({ sourceLanguage: "ro", targetLanguage: "en" })).toBe(
    "unavailable",
  );
});

test("create rejects with NotSupportedError when the pair is not in the manifest", async () => {
  await expect(
    WasmBackend.create({ sourceLanguage: "en", targetLanguage: "el" }),
  ).rejects.toMatchObject({ name: "NotSupportedError" });
});

test("manifest covers every advertised pair in both directions", () => {
  // 20 en-bridges × 2 + 8 direct non-en × 2 + 11 unidirectional = 67 entries.
  expect(MANIFEST).toHaveLength(67);
  // Every entry has a unique (source, target) key.
  const keys = new Set(MANIFEST.map((m) => `${m.source}-${m.target}`));
  expect(keys.size).toBe(MANIFEST.length);
  // The Japanese override surfaces BCP 47 'ja' while pointing at the
  // Hub-internal 'jap' tag.
  const enJa = MANIFEST.find((m) => m.source === "en" && m.target === "ja");
  expect(enJa?.modelId).toBe("Xenova/opus-mt-en-jap");
  const jaEn = MANIFEST.find((m) => m.source === "ja" && m.target === "en");
  expect(jaEn?.modelId).toBe("Xenova/opus-mt-jap-en");
});

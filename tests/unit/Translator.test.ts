import { afterEach, expect, test, vi } from "vite-plus/test";
import { Translator } from "../../src/Translator.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("availability returns 'unavailable' when no backend supports the pair", async () => {
  // 'en' → 'el' is not in the manifest (no Helsinki-NLP model on the Hub) and
  // there's no native backend in JSDOM.
  expect(await Translator.availability({ sourceLanguage: "en", targetLanguage: "el" })).toBe(
    "unavailable",
  );
});

test("availability bubbles up the native answer when WASM is unavailable", async () => {
  vi.stubGlobal("Translator", {
    availability: vi.fn(async () => "available" as const),
    create: vi.fn(),
  });

  expect(await Translator.availability({ sourceLanguage: "en", targetLanguage: "de" })).toBe(
    "available",
  );
});

test("create rejects with NotSupportedError when no backend supports the pair", async () => {
  await expect(
    Translator.create({ sourceLanguage: "en", targetLanguage: "el" }),
  ).rejects.toMatchObject({ name: "NotSupportedError" });
});

test("create rejects with AbortError when signal is already aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  await expect(
    Translator.create({ sourceLanguage: "en", targetLanguage: "el", signal: ac.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("destroyed translator throws InvalidStateError on subsequent calls", async () => {
  const nativeInstance = {
    inputQuota: 100,
    sourceLanguage: "en",
    targetLanguage: "de",
    translate: vi.fn(async (input: string) => input.toUpperCase()),
    translateStreaming: vi.fn(),
    measureInputUsage: vi.fn(),
    destroy: vi.fn(),
  };
  vi.stubGlobal("Translator", {
    availability: vi.fn(async () => "available" as const),
    create: vi.fn(async () => nativeInstance),
  });

  const t = await Translator.create({ sourceLanguage: "en", targetLanguage: "de" });
  expect(await t.translate("hi")).toBe("HI");
  t.destroy();
  expect(nativeInstance.destroy).toHaveBeenCalled();
  await expect(t.translate("hi")).rejects.toMatchObject({ name: "InvalidStateError" });
  expect(() => t.inputQuota).toThrow();
});

test("destroy is idempotent", async () => {
  const nativeInstance = {
    inputQuota: 0,
    sourceLanguage: "en",
    targetLanguage: "de",
    translate: vi.fn(),
    translateStreaming: vi.fn(),
    measureInputUsage: vi.fn(),
    destroy: vi.fn(),
  };
  vi.stubGlobal("Translator", {
    availability: vi.fn(async () => "available" as const),
    create: vi.fn(async () => nativeInstance),
  });

  const t = await Translator.create({ sourceLanguage: "en", targetLanguage: "de" });
  t.destroy();
  t.destroy();
  expect(nativeInstance.destroy).toHaveBeenCalledTimes(1);
});

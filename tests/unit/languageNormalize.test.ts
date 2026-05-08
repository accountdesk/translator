import { expect, test } from "vite-plus/test";
import { normalizeBaseTag } from "../../src/utils/languageNormalize.ts";

test("strips region subtag", () => {
  expect(normalizeBaseTag("en-US")).toBe("en");
  expect(normalizeBaseTag("de-DE")).toBe("de");
  expect(normalizeBaseTag("es-419")).toBe("es");
});

test("strips script subtag", () => {
  expect(normalizeBaseTag("zh-Hans")).toBe("zh");
  expect(normalizeBaseTag("zh-Hant-TW")).toBe("zh");
  expect(normalizeBaseTag("sr-Cyrl-RS")).toBe("sr");
});

test("lowercases the base tag", () => {
  expect(normalizeBaseTag("EN")).toBe("en");
  expect(normalizeBaseTag("DE-de")).toBe("de");
  expect(normalizeBaseTag("ZH-Hans-CN")).toBe("zh");
});

test("accepts underscore separators (Java/Android convention)", () => {
  expect(normalizeBaseTag("en_US")).toBe("en");
  expect(normalizeBaseTag("pt_BR")).toBe("pt");
  expect(normalizeBaseTag("zh_Hans_CN")).toBe("zh");
});

test("returns the trimmed input when there is no subtag", () => {
  expect(normalizeBaseTag("ja")).toBe("ja");
  expect(normalizeBaseTag("  fr  ")).toBe("fr");
});

test("returns the empty string for empty or whitespace input", () => {
  expect(normalizeBaseTag("")).toBe("");
  expect(normalizeBaseTag("   ")).toBe("");
});

test("falls back gracefully for malformed tags", () => {
  // privateuse tags throw in Intl.Locale — fallback path keeps the first
  // component so consumers still see a deterministic answer.
  expect(normalizeBaseTag("x-private")).toBe("x");
});

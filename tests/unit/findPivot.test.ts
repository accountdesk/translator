import { expect, test } from "vite-plus/test";
import { findPivot } from "../../src/backends/modelManifest.ts";

test("returns null when source equals target", () => {
  expect(findPivot("en", "en")).toBeNull();
  expect(findPivot("de", "de")).toBeNull();
});

test("returns null when one side is already English", () => {
  // findModel handles direct en↔X — pivot should never apply there.
  expect(findPivot("en", "de")).toBeNull();
  expect(findPivot("de", "en")).toBeNull();
});

test("finds a pivot for typical cross-language pairs (de→zh, fr→ja, es→hi)", () => {
  const deZh = findPivot("de", "zh");
  expect(deZh).not.toBeNull();
  expect(deZh?.pivot).toBe("en");
  expect(deZh?.hop1.modelId).toBe("Xenova/opus-mt-de-en");
  expect(deZh?.hop2.modelId).toBe("Xenova/opus-mt-en-zh");

  const frJa = findPivot("fr", "ja");
  expect(frJa).not.toBeNull();
  expect(frJa?.hop1.modelId).toBe("Xenova/opus-mt-fr-en");
  expect(frJa?.hop2.modelId).toBe("Xenova/opus-mt-en-jap"); // ja→jap mapping

  expect(findPivot("es", "hi")).not.toBeNull();
  expect(findPivot("ar", "ko")).toBeNull(); // en→ko isn't in the catalog
});

test("returns null when one half of the pivot is missing", () => {
  // en→ro exists, ro→en does not. Therefore X→ro routes (via en) work,
  // but ro→Y routes don't — there's nothing to bridge from ro to en.
  expect(findPivot("ro", "de")).toBeNull();
  // The reverse: en→pl is missing, so X→pl pivots are unreachable.
  expect(findPivot("de", "pl")).toBeNull();
});

test("does not pivot when a direct path already exists", () => {
  // The function intentionally never returns a pivot for `(en, X)` /
  // `(X, en)` and assumes callers tried `findModel` first for non-en pairs
  // — that's the contract documented on `findPivot`. We only assert the
  // self-language and en-half guards here.
  expect(findPivot("en", "de")).toBeNull();
  expect(findPivot("de", "en")).toBeNull();
});

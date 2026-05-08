import { expect, test } from "vite-plus/test";
import { splitSentences } from "../../src/utils/sentenceSplit.ts";

test("splits on full stop, exclamation, question mark", () => {
  expect(splitSentences("Hello world. How are you? I am fine!")).toEqual([
    "Hello world.",
    "How are you?",
    "I am fine!",
  ]);
});

test("splits on CJK terminators", () => {
  expect(splitSentences("你好世界。 今天天气怎么样？ 很好！")).toEqual([
    "你好世界。",
    "今天天气怎么样?".replace("?", "？"),
    "很好！",
  ]);
});

test("returns single chunk when there is no terminator", () => {
  expect(splitSentences("Hello world without punctuation")).toEqual([
    "Hello world without punctuation",
  ]);
});

test("returns empty array for empty input", () => {
  expect(splitSentences("")).toEqual([]);
});

test("trims trailing empty chunks from extra whitespace", () => {
  expect(splitSentences("One. Two.   ")).toEqual(["One.", "Two."]);
});

test("over-splits abbreviations (acceptable for v1)", () => {
  // "Dr. Smith arrived." -> ["Dr.", "Smith arrived."]
  // The consumer rejoins these so the translation result is still readable.
  const out = splitSentences("Dr. Smith arrived.");
  expect(out.length).toBeGreaterThan(1);
});

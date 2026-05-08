// Sentence segmentation for translateStreaming. Cheap regex split is good
// enough for v1 — it covers Latin punctuation plus the most common CJK
// terminators. We deliberately do NOT recurse into abbreviations
// ("Dr. Smith", "e.g.") because the over-split is harmless: each sentence
// is independently translated and rejoined by the consumer.
//
// `Intl.Segmenter` would be more correct but its support for sentence
// granularity is uneven across browsers as of 2026. Worth revisiting.

const SENTENCE_TERMINATORS = /(?<=[.!?。！？])\s+/u;

export function splitSentences(input: string): string[] {
  if (input.length === 0) return [];
  const parts = input.split(SENTENCE_TERMINATORS);
  // Drop empty segments produced by trailing whitespace etc.
  return parts.filter((s) => s.length > 0);
}

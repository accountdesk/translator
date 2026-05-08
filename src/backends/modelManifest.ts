// Quantization variants we accept. Maps 1:1 onto Transformers.js' `dtype`
// option. We deliberately don't expose `q8`/`int8`/`uint8`/`q4`/`q4f16` here:
// those are the small "N-bit" variants and onnxruntime-web's MatMulNBits op
// chokes on the merged-decoder shards of several Helsinki-NLP exports
// (`Missing required scale: model.shared.weight_merged_0_scale`). `fp16` is
// the smallest-stable choice; `fp32` is the no-quantization fallback.
export type Quantization = "fp16" | "fp32";

export interface ModelDescriptor {
  source: string;
  target: string;
  modelId: string;
  approxSizeMb: number;
  quantization: Quantization;
}

// Helsinki-NLP MarianMT, ONNX-converted by the Xenova org. Verified to exist on
// the Hugging Face Hub at the time of writing (https://huggingface.co/Xenova).
// Listing is intentionally restricted to pairs where BOTH directions exist —
// asymmetric pairs make for confusing consumer DX. Sizes are approximate
// (fp16 encoder + merged decoder, excluding tokenizer files).
//
// Note on `ja`: Helsinki-NLP uses the legacy ISO 639-1 code `jap`, but the
// public BCP 47 surface stays `ja`. The mapping happens here in the manifest.
// Sourced from `huggingface.co/api/models?author=Xenova&search=opus-mt`. Every
// single-pair Xenova/opus-mt-* repo is in here. Group multilingual models
// (`opus-mt-en-ROMANCE`, `opus-mt-gem-gem`, `opus-mt-mul-en`, …) need
// src_lang/tgt_lang at inference time and are out of v1 scope.

// Pairs where BOTH directions exist on the Hub.
const BIDIRECTIONAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // English bridges (20 pairs, 40 models).
  ["en", "af"],
  ["en", "ar"],
  ["en", "cs"],
  ["en", "da"],
  ["en", "de"],
  ["en", "es"],
  ["en", "fi"],
  ["en", "fr"],
  ["en", "hi"],
  ["en", "hu"],
  ["en", "id"],
  ["en", "it"],
  ["en", "ja"],
  ["en", "nl"],
  ["en", "ru"],
  ["en", "sv"],
  ["en", "uk"],
  ["en", "vi"],
  ["en", "xh"],
  ["en", "zh"],
  // Direct non-English bridges (8 pairs, 16 models). These avoid the
  // round-trip-through-English quality loss for users who routinely move
  // text between e.g. Spanish and German.
  ["de", "fr"],
  ["es", "de"],
  ["es", "fr"],
  ["es", "it"],
  ["es", "ru"],
  ["fr", "ro"],
  ["ru", "fr"],
  ["ru", "uk"],
];

// Pairs where ONLY one direction exists on the Hub. Listed as `[src, tgt]`,
// no auto-reversal. `availability(tgt → src)` will return `'unavailable'` —
// that's accurate, since no model exists. Most of these are X→en exports
// (Polish, Korean, Turkish, Thai…) without a corresponding en→X release.
const UNIDIRECTIONAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["en", "ro"], // ro→en not on Hub
  ["da", "de"], // de→da not on Hub (non-English bridge)
  ["et", "en"], // en→et not on Hub (Estonian)
  ["fi", "de"], // de→fi not on Hub
  ["it", "fr"], // fr→it not on Hub (non-English bridge)
  ["ko", "en"], // en→ko not on Hub (Korean)
  ["nl", "fr"], // fr→nl not on Hub (non-English bridge)
  ["no", "de"], // de→no not on Hub (Norwegian, ISO `no`)
  ["pl", "en"], // en→pl not on Hub (Polish)
  ["th", "en"], // en→th not on Hub (Thai)
  ["tr", "en"], // en→tr not on Hub (Turkish)
];

// Hub repo IDs sometimes differ from the BCP 47 tag we surface; map here.
const HUB_TAG_OVERRIDES: Record<string, string> = {
  ja: "jap",
};

function hubTag(bcp47: string): string {
  return HUB_TAG_OVERRIDES[bcp47] ?? bcp47;
}

const DEFAULT_QUANT: Quantization = "fp16";

// fp16 encoder (~98 MB) + fp16 merged decoder (~110 MB) for an MarianMT pair.
const APPROX_SIZE_FP16_MB = 210;

function entry(source: string, target: string): ModelDescriptor {
  return {
    source,
    target,
    modelId: `Xenova/opus-mt-${hubTag(source)}-${hubTag(target)}`,
    approxSizeMb: APPROX_SIZE_FP16_MB,
    quantization: DEFAULT_QUANT,
  };
}

function buildManifest(): ModelDescriptor[] {
  const out: ModelDescriptor[] = [];
  for (const [a, b] of BIDIRECTIONAL_PAIRS) {
    out.push(entry(a, b), entry(b, a));
  }
  for (const [src, tgt] of UNIDIRECTIONAL_PAIRS) {
    out.push(entry(src, tgt));
  }
  return out;
}

export const MANIFEST: readonly ModelDescriptor[] = buildManifest();

export function findModel(source: string, target: string): ModelDescriptor | undefined {
  return MANIFEST.find((m) => m.source === source && m.target === target);
}

export interface PivotPath {
  hop1: ModelDescriptor;
  hop2: ModelDescriptor;
  pivot: string;
}

/**
 * If no direct model exists for (source, target), try to route through
 * English. Pivot via English is the only option that consistently works
 * across the Helsinki-NLP catalog — most other potential pivots have far
 * narrower coverage. Returns null when neither a direct nor a pivot path
 * is reachable.
 *
 * Direct paths always win: callers should call `findModel(source, target)`
 * first and only fall back here on miss.
 */
export function findPivot(source: string, target: string): PivotPath | null {
  if (source === target) return null;
  if (source === "en" || target === "en") return null; // a hop through self
  const hop1 = findModel(source, "en");
  const hop2 = findModel("en", target);
  if (!hop1 || !hop2) return null;
  return { hop1, hop2, pivot: "en" };
}

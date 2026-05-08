import {
  pipeline,
  type TranslationOutput,
  type TranslationPipeline,
} from "@huggingface/transformers";
import { splitSentences } from "./utils/sentenceSplit.ts";
import type { WorkerInbound, WorkerOutbound } from "./workerClient.ts";

interface WorkerScope {
  postMessage(message: WorkerOutbound): void;
  addEventListener(type: "message", listener: (event: { data: WorkerInbound }) => void): void;
}

const scope = globalThis as unknown as WorkerScope;

interface LoadArgs {
  modelId: string;
  dtype: "fp16" | "fp32";
}

interface TranslateArgs {
  text: string;
}

interface MeasureArgs {
  text: string;
}

let translator: TranslationPipeline | undefined;
let loadedModelId: string | undefined;
const inFlight = new Set<number>();

scope.addEventListener("message", (event) => {
  const message = event.data;
  if ("abort" in message) {
    inFlight.delete(message.id);
    return;
  }
  void handle(message.id, message.method, message.args);
});

async function handle(id: number, method: string, args: unknown): Promise<void> {
  inFlight.add(id);
  try {
    const result = await dispatch(method, args, id);
    if (!inFlight.has(id)) return;
    scope.postMessage({ id, result });
  } catch (err) {
    if (!inFlight.has(id)) return;
    const error =
      err instanceof Error
        ? { name: err.name, message: err.message }
        : { name: "OperationError", message: String(err) };
    scope.postMessage({ id, error });
  } finally {
    inFlight.delete(id);
  }
}

async function dispatch(method: string, args: unknown, id: number): Promise<unknown> {
  switch (method) {
    case "load":
      return load(args as LoadArgs, id);
    case "translate":
      return translate(args as TranslateArgs);
    case "translateStreaming":
      return translateStreaming(args as TranslateArgs, id);
    case "measure":
      return measure(args as MeasureArgs);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

async function load(args: LoadArgs, id: number): Promise<void> {
  if (loadedModelId === args.modelId && translator) return;
  translator = (await pipeline("translation", args.modelId, {
    device: "wasm",
    dtype: args.dtype,
    // onnxruntime-web's graph optimizer trips over the Helsinki-NLP exports
    // in two different ways depending on dtype:
    //  - q8/int8: `MatMulNBits Missing required scale: model.shared.weight_merged_0_scale`
    //    (DequantizeLinear transpose pass mis-handles the merged-decoder shards)
    //  - fp16: `SimplifiedLayerNormFusion ... InsertedPrecisionFreeCast_*`
    //    (LayerNorm-Cast fusion expects a Cast node the export doesn't emit)
    // 'basic' skips the extended fusion passes that hit those bugs while
    // keeping useful op-level optimizations. Costs ~2% inference latency on
    // small inputs — irrelevant for messaging.
    session_options: { graphOptimizationLevel: "basic" },
    progress_callback: (data: unknown) => {
      if (!inFlight.has(id)) return;
      scope.postMessage({ id, progress: data });
    },
  })) as TranslationPipeline;
  loadedModelId = args.modelId;
}

async function translate(args: TranslateArgs): Promise<string> {
  if (!translator) {
    throw new Error("Pipeline not loaded.");
  }
  const output = (await translator(args.text)) as TranslationOutput;
  return output[0]?.translation_text ?? "";
}

async function translateStreaming(args: TranslateArgs, id: number): Promise<string> {
  if (!translator) {
    throw new Error("Pipeline not loaded.");
  }
  const sentences = splitSentences(args.text);
  if (sentences.length === 0) return "";

  const collected: string[] = [];
  for (const sentence of sentences) {
    // Cooperative abort: if the client signaled abort we drop out before
    // starting the next sentence. The current sentence still completes —
    // Transformers.js doesn't expose mid-generation cancellation.
    if (!inFlight.has(id)) {
      throw new DOMException("aborted", "AbortError");
    }
    const output = (await translator(sentence)) as TranslationOutput;
    const translated = output[0]?.translation_text ?? "";
    collected.push(translated);
    if (inFlight.has(id)) {
      // Surface each translated sentence as a streaming chunk via the
      // progress channel. Final 'result' (full text) goes via the normal
      // RPC return path so callers that prefer await over for-await still
      // get a complete translation.
      scope.postMessage({ id, progress: { chunk: translated } });
    }
  }
  return collected.join(" ");
}

function measure(args: MeasureArgs): number {
  if (!translator) {
    throw new Error("Pipeline not loaded.");
  }
  const tokenizer = (translator as unknown as { tokenizer: Tokenizer }).tokenizer;
  const encoded = tokenizer(args.text, { return_tensor: false }) as TokenizerOutput;
  const ids = encoded.input_ids;
  // input_ids may be number[] (return_tensor: false) or wrapped — handle both.
  if (Array.isArray(ids)) return ids.length;
  if (typeof ids === "object" && ids !== null && "length" in ids) {
    return (ids as { length: number }).length;
  }
  return 0;
}

// Minimal local types for the tokenizer API surface we touch — Transformers.js
// types aren't reexported from `@huggingface/transformers` for this depth.
type Tokenizer = (text: string, options?: { return_tensor?: boolean }) => TokenizerOutput;

interface TokenizerOutput {
  input_ids: number[] | { length: number };
}

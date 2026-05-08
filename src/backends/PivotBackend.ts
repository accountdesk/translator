import type { CreateMonitorImpl } from "../monitor.ts";
import type { TranslatorCreateOptions } from "../types.ts";
import type { BackendInstance } from "./Backend.ts";
import type { PivotPath } from "./modelManifest.ts";
import { ProgressAggregator } from "./progressAggregator.ts";
import { type WasmBackendInstance, type WorkerFactory, loadInstance } from "./WasmBackend.ts";

/**
 * Wraps two `WasmBackendInstance`s — one for `source → pivot`, one for
 * `pivot → target` — to translate any pair the Helsinki-NLP catalog only
 * routes through English. See `findPivot` in `modelManifest.ts` for the
 * pivot-selection logic.
 */
export class PivotBackendInstance implements BackendInstance {
  readonly inputQuota = Number.POSITIVE_INFINITY;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  #hop1: WasmBackendInstance;
  #hop2: WasmBackendInstance;
  #destroyed = false;

  constructor(
    hop1: WasmBackendInstance,
    hop2: WasmBackendInstance,
    sourceLanguage: string,
    targetLanguage: string,
  ) {
    this.#hop1 = hop1;
    this.#hop2 = hop2;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
  }

  async translate(input: string, signal?: AbortSignal): Promise<string> {
    const intermediate = await this.#hop1.translate(input, signal);
    return this.#hop2.translate(intermediate, signal);
  }

  translateStreaming(input: string, signal?: AbortSignal): ReadableStream<string> {
    // Pull sentence-by-sentence from hop1's stream, run hop2 on each chunk,
    // emit. Buffering the whole hop1 output before starting hop2 would
    // double the user-visible latency; this way hop2 starts as soon as the
    // first sentence is ready.
    const hop1 = this.#hop1;
    const hop2 = this.#hop2;
    let cancelled = false;
    const ac = new AbortController();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    return new ReadableStream<string>({
      async start(controller) {
        try {
          const stream = hop1.translateStreaming(input, ac.signal);
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done || cancelled) break;
            const translated = await hop2.translate(value, ac.signal);
            if (cancelled) break;
            controller.enqueue(translated);
          }
          if (!cancelled) controller.close();
        } catch (err) {
          if (!cancelled) controller.error(err);
        }
      },
      cancel() {
        cancelled = true;
        ac.abort();
      },
    });
  }

  measureInputUsage(input: string): Promise<number> {
    // Use the source-side tokenizer — that's what the consumer's input is
    // measured against.
    return this.#hop1.measureInputUsage(input);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#hop1.destroy();
    this.#hop2.destroy();
  }
}

/**
 * Spawn two workers in parallel, load both pivot models concurrently, and
 * return a {@link PivotBackendInstance}. Parallel download keeps the user-
 * facing first-translation latency bounded by the slower of the two model
 * downloads, not their sum.
 */
export async function createPivot(
  pivot: PivotPath,
  factory: WorkerFactory,
  opts: TranslatorCreateOptions,
  monitor: CreateMonitorImpl | undefined,
): Promise<PivotBackendInstance> {
  // Combine progress from both hops into a single 0..1 stream. Each hop
  // owns half of the bar. Both progress in parallel, so the bar
  // monotonically advances toward 1.0 even when hops finish out of order.
  let p1 = 0;
  let p2 = 0;
  const emit = monitor ? () => monitor.emitProgress((p1 + p2) / 2) : undefined;
  const agg1 = emit
    ? new ProgressAggregator((l) => {
        p1 = l;
        emit();
      })
    : undefined;
  const agg2 = emit
    ? new ProgressAggregator((l) => {
        p2 = l;
        emit();
      })
    : undefined;

  let hop1: WasmBackendInstance | undefined;
  let hop2: WasmBackendInstance | undefined;
  try {
    [hop1, hop2] = await Promise.all([
      loadInstance(pivot.hop1, factory, opts.sourceLanguage, pivot.pivot, {
        signal: opts.signal,
        onProgress: agg1 ? (p) => agg1.ingest(p) : undefined,
      }),
      loadInstance(pivot.hop2, factory, pivot.pivot, opts.targetLanguage, {
        signal: opts.signal,
        onProgress: agg2 ? (p) => agg2.ingest(p) : undefined,
      }),
    ]);
  } catch (err) {
    // If one hop loaded but the other failed, the loaded one still owns a
    // worker we need to clean up.
    hop1?.destroy();
    hop2?.destroy();
    throw err;
  }

  return new PivotBackendInstance(hop1, hop2, opts.sourceLanguage, opts.targetLanguage);
}

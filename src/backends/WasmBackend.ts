import { translatorError } from "../errors.ts";
import { type CreateMonitorImpl, buildMonitor } from "../monitor.ts";
import type { Availability, TranslatorCreateOptions, TranslatorOptions } from "../types.ts";
import { normalizeBaseTag } from "../utils/languageNormalize.ts";
import { WorkerClient } from "../workerClient.ts";
import type { Backend, BackendInstance } from "./Backend.ts";
import { type ModelDescriptor, findModel, findPivot } from "./modelManifest.ts";
import { createPivot } from "./PivotBackend.ts";
import { ProgressAggregator } from "./progressAggregator.ts";

export type WorkerFactory = () => Worker;

let defaultWorkerFactory: WorkerFactory | undefined;

/**
 * Configure how `WasmBackend` spawns its inference worker. The default export
 * (`@accountdesk/translator`) wires this up to a Vite/Webpack-friendly static
 * `new URL(...)` literal; the `./bundle` entry wires it up to an inlined
 * blob-URL worker instead. Consumers can also override per call by passing
 * `worker` to `Translator.create`.
 */
export function setDefaultWasmWorkerFactory(factory: WorkerFactory): void {
  defaultWorkerFactory = factory;
}

export class WasmBackendInstance implements BackendInstance {
  readonly inputQuota = Number.POSITIVE_INFINITY;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  #client: WorkerClient;

  constructor(client: WorkerClient, sourceLanguage: string, targetLanguage: string) {
    this.#client = client;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
  }

  translate(input: string, signal?: AbortSignal): Promise<string> {
    return this.#client.call<string>("translate", { text: input }, { signal });
  }

  translateStreaming(input: string, signal?: AbortSignal): ReadableStream<string> {
    const client = this.#client;
    let cancelled = false;
    const ac = new AbortController();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    return new ReadableStream<string>({
      async start(controller) {
        try {
          await client.call<string>(
            "translateStreaming",
            { text: input },
            {
              signal: ac.signal,
              onProgress: (payload) => {
                if (cancelled) return;
                const p = payload as { chunk?: string };
                if (typeof p.chunk === "string") controller.enqueue(p.chunk);
              },
            },
          );
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
    return this.#client.call<number>("measure", { text: input });
  }

  destroy(): void {
    this.#client.terminate();
  }
}

export interface LoadInstanceOptions {
  signal?: AbortSignal;
  onProgress?: (payload: unknown) => void;
}

/**
 * Spawn a worker, load a single Helsinki-NLP model into it, and return a
 * ready-to-translate {@link WasmBackendInstance}. Used both for direct paths
 * (one call) and for pivot paths (two parallel calls from `PivotBackend`).
 */
export async function loadInstance(
  model: ModelDescriptor,
  factory: WorkerFactory,
  sourceLanguage: string,
  targetLanguage: string,
  opts: LoadInstanceOptions = {},
): Promise<WasmBackendInstance> {
  const client = new WorkerClient(factory());
  try {
    await client.call<void>(
      "load",
      { modelId: model.modelId, dtype: model.quantization },
      { signal: opts.signal, onProgress: opts.onProgress },
    );
  } catch (err) {
    client.terminate();
    throw err;
  }
  return new WasmBackendInstance(client, sourceLanguage, targetLanguage);
}

function pickFactory(): WorkerFactory {
  if (!defaultWorkerFactory) {
    throw translatorError(
      "NotSupportedError",
      "No worker factory configured. Import from '@accountdesk/translator' (lean, " +
        "static-URL worker) or '@accountdesk/translator/bundle' (worker inlined " +
        "as base64) — both wire this up automatically.",
    );
  }
  return defaultWorkerFactory;
}

export const WasmBackend: Backend = {
  name: "wasm",

  availability(opts: TranslatorOptions): Promise<Availability> {
    const src = normalizeBaseTag(opts.sourceLanguage);
    const tgt = normalizeBaseTag(opts.targetLanguage);
    if (findModel(src, tgt)) return Promise.resolve("downloadable");
    if (findPivot(src, tgt)) return Promise.resolve("downloadable");
    return Promise.resolve("unavailable");
  },

  async create(opts: TranslatorCreateOptions): Promise<BackendInstance> {
    const src = normalizeBaseTag(opts.sourceLanguage);
    const tgt = normalizeBaseTag(opts.targetLanguage);
    const factory = pickFactory();
    const monitor: CreateMonitorImpl | undefined = opts.monitor
      ? buildMonitor(opts.monitor)
      : undefined;

    const direct = findModel(src, tgt);
    if (direct) {
      const aggregator = monitor
        ? new ProgressAggregator((loaded) => monitor.emitProgress(loaded))
        : undefined;
      return loadInstance(direct, factory, opts.sourceLanguage, opts.targetLanguage, {
        signal: opts.signal,
        onProgress: aggregator ? (p) => aggregator.ingest(p) : undefined,
      });
    }

    const pivot = findPivot(src, tgt);
    if (pivot) {
      return createPivot(pivot, factory, opts, monitor);
    }

    throw translatorError(
      "NotSupportedError",
      `WASM backend has no direct model and no pivot path for ${opts.sourceLanguage} → ${opts.targetLanguage}.`,
    );
  },
};

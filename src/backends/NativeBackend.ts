import { translatorError } from "../errors.ts";
import { type CreateMonitorImpl, buildMonitor } from "../monitor.ts";
import type { Availability, TranslatorCreateOptions, TranslatorOptions } from "../types.ts";
import type { Backend, BackendInstance } from "./Backend.ts";

interface NativeProgressEvent extends Event {
  loaded: number;
}

interface NativeMonitor {
  addEventListener(type: "downloadprogress", listener: (event: NativeProgressEvent) => void): void;
}

interface NativeTranslator {
  readonly inputQuota: number;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  measureInputUsage(input: string): Promise<number>;
  destroy(): void;
}

interface NativeTranslatorStatic {
  availability(opts: TranslatorOptions): Promise<Availability>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: NativeMonitor) => void;
    signal?: AbortSignal;
  }): Promise<NativeTranslator>;
}

function getNative(): NativeTranslatorStatic | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const candidate = (globalThis as { Translator?: unknown }).Translator;
  if (
    candidate &&
    typeof candidate === "object" &&
    "availability" in candidate &&
    "create" in candidate
  ) {
    return candidate as NativeTranslatorStatic;
  }
  return undefined;
}

class NativeBackendInstance implements BackendInstance {
  constructor(private readonly inner: NativeTranslator) {}

  get inputQuota(): number {
    return this.inner.inputQuota;
  }
  get sourceLanguage(): string {
    return this.inner.sourceLanguage;
  }
  get targetLanguage(): string {
    return this.inner.targetLanguage;
  }

  translate(input: string, signal?: AbortSignal): Promise<string> {
    return this.inner.translate(input, signal ? { signal } : undefined);
  }

  translateStreaming(input: string, signal?: AbortSignal): ReadableStream<string> {
    return this.inner.translateStreaming(input, signal ? { signal } : undefined);
  }

  measureInputUsage(input: string): Promise<number> {
    return this.inner.measureInputUsage(input);
  }

  destroy(): void {
    this.inner.destroy();
  }
}

export const NativeBackend: Backend = {
  name: "native",

  async availability(opts: TranslatorOptions): Promise<Availability> {
    const native = getNative();
    if (!native) return "unavailable";
    try {
      return await native.availability(opts);
    } catch {
      return "unavailable";
    }
  },

  async create(opts: TranslatorCreateOptions): Promise<BackendInstance> {
    const native = getNative();
    if (!native) {
      throw translatorError("NotSupportedError", "Native Translator is unavailable.");
    }
    const monitor: CreateMonitorImpl | undefined = opts.monitor
      ? buildMonitor(opts.monitor)
      : undefined;
    const inner = await native.create({
      sourceLanguage: opts.sourceLanguage,
      targetLanguage: opts.targetLanguage,
      signal: opts.signal,
      monitor: monitor
        ? (nativeMon: NativeMonitor) => {
            nativeMon.addEventListener("downloadprogress", (event: NativeProgressEvent) => {
              monitor.emitProgress(event.loaded);
            });
          }
        : undefined,
    });
    return new NativeBackendInstance(inner);
  },
};

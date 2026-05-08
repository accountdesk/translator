import type { Availability, TranslatorCreateOptions, TranslatorOptions } from "../types.ts";

export interface Backend {
  readonly name: "native" | "wasm";
  availability(opts: TranslatorOptions): Promise<Availability>;
  create(opts: TranslatorCreateOptions): Promise<BackendInstance>;
}

export interface BackendInstance {
  readonly inputQuota: number;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  translate(input: string, signal?: AbortSignal): Promise<string>;
  translateStreaming(input: string, signal?: AbortSignal): ReadableStream<string>;
  measureInputUsage(input: string): Promise<number>;
  destroy(): void;
}

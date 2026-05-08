import type { BackendInstance } from "./backends/Backend.ts";
import { NativeBackend } from "./backends/NativeBackend.ts";
import { WasmBackend } from "./backends/WasmBackend.ts";
import { throwIfAborted, translatorError } from "./errors.ts";
import type {
  Availability,
  TranslateOptions,
  TranslatorCreateOptions,
  TranslatorOptions,
} from "./types.ts";
import { mergeAvailability } from "./utils/mergeAvailability.ts";

export class Translator {
  #backend: BackendInstance;
  #destroyed = false;

  private constructor(backend: BackendInstance) {
    this.#backend = backend;
  }

  static async availability(options: TranslatorOptions): Promise<Availability> {
    const [native, wasm] = await Promise.all([
      NativeBackend.availability(options),
      WasmBackend.availability(options),
    ]);
    return mergeAvailability(native, wasm);
  }

  static async create(options: TranslatorCreateOptions): Promise<Translator> {
    throwIfAborted(options.signal);

    const nativeAvail = await NativeBackend.availability(options);
    if (nativeAvail !== "unavailable") {
      const instance = await NativeBackend.create(options);
      return new Translator(instance);
    }

    const wasmAvail = await WasmBackend.availability(options);
    if (wasmAvail !== "unavailable") {
      const instance = await WasmBackend.create(options);
      return new Translator(instance);
    }

    throw translatorError(
      "NotSupportedError",
      `No backend available for ${options.sourceLanguage} → ${options.targetLanguage}.`,
    );
  }

  get inputQuota(): number {
    this.#assertAlive();
    return this.#backend.inputQuota;
  }

  get sourceLanguage(): string {
    this.#assertAlive();
    return this.#backend.sourceLanguage;
  }

  get targetLanguage(): string {
    this.#assertAlive();
    return this.#backend.targetLanguage;
  }

  async translate(input: string, options?: TranslateOptions): Promise<string> {
    this.#assertAlive();
    throwIfAborted(options?.signal);
    return this.#backend.translate(input, options?.signal);
  }

  translateStreaming(input: string, options?: TranslateOptions): ReadableStream<string> {
    this.#assertAlive();
    throwIfAborted(options?.signal);
    return this.#backend.translateStreaming(input, options?.signal);
  }

  async measureInputUsage(input: string): Promise<number> {
    this.#assertAlive();
    return this.#backend.measureInputUsage(input);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#backend.destroy();
  }

  #assertAlive(): void {
    if (this.#destroyed) {
      throw translatorError("InvalidStateError", "Translator has been destroyed.");
    }
  }
}

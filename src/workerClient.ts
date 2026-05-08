import { translatorError } from "./errors.ts";

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown;
}

export interface WorkerAbort {
  id: number;
  abort: true;
}

export type WorkerInbound = WorkerRequest | WorkerAbort;

export type WorkerOutbound =
  | { id: number; result: unknown }
  | { id: number; error: { name: string; message: string } }
  | { id: number; progress: unknown };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (progress: unknown) => void;
}

export interface WorkerLike {
  postMessage(message: WorkerInbound): void;
  addEventListener(type: "message", listener: (event: { data: WorkerOutbound }) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: Event) => void): void;
  terminate(): void;
}

export class WorkerClient {
  #worker: WorkerLike;
  #pending = new Map<number, Pending>();
  #nextId = 0;
  #terminated = false;

  constructor(worker: WorkerLike) {
    this.#worker = worker;
    worker.addEventListener("message", (event: { data: WorkerOutbound }) =>
      this.#handle(event.data),
    );
    worker.addEventListener("error", (event: ErrorEvent) =>
      this.#failAll(event.message || "Worker error"),
    );
    worker.addEventListener("messageerror", () =>
      this.#failAll("Worker message deserialization failed"),
    );
  }

  call<T>(
    method: string,
    args: unknown,
    options: { signal?: AbortSignal; onProgress?: (progress: unknown) => void } = {},
  ): Promise<T> {
    if (this.#terminated) {
      return Promise.reject(translatorError("InvalidStateError", "Worker has been terminated."));
    }
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      return Promise.reject(translatorError("AbortError", "The operation was aborted."));
    }

    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(id);
        try {
          this.#worker.postMessage({ id, abort: true });
        } catch {
          // Worker already gone — ignore.
        }
        reject(translatorError("AbortError", "The operation was aborted."));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.#pending.set(id, {
        resolve: (value) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve(value as T);
        },
        reject: (reason) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(reason);
        },
        onProgress,
      });
      this.#worker.postMessage({ id, method, args });
    });
  }

  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.terminate();
    this.#failAll("Worker terminated");
  }

  #handle(message: WorkerOutbound): void {
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    if ("progress" in message) {
      pending.onProgress?.(message.progress);
      return;
    }
    this.#pending.delete(message.id);
    if ("error" in message) {
      pending.reject(
        translatorError(
          (message.error.name as Parameters<typeof translatorError>[0]) || "OperationError",
          message.error.message,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  #failAll(reason: string): void {
    const error = translatorError("OperationError", reason);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

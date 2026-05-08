export type TranslatorErrorName =
  | "NotSupportedError"
  | "InvalidStateError"
  | "NotAllowedError"
  | "QuotaExceededError"
  | "AbortError"
  | "OperationError"
  | "NetworkError";

export function translatorError(name: TranslatorErrorName, message: string): DOMException {
  return new DOMException(message, name);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw translatorError("AbortError", "The operation was aborted.");
  }
}

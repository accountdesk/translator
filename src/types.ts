export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

export interface TranslatorOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslatorCreateOptions extends TranslatorOptions {
  monitor?: CreateMonitorCallback;
  signal?: AbortSignal;
  /**
   * Override the WASM worker factory for this call. Useful when consumers want
   * a long-lived shared worker, a pre-warmed pool, or a custom worker URL.
   * Ignored on the native code path.
   */
  worker?: () => Worker;
}

export type CreateMonitorCallback = (monitor: CreateMonitor) => void;

export interface DownloadProgressEventInit extends EventInit {
  loaded: number;
}

export declare class DownloadProgressEvent extends Event {
  constructor(type: string, eventInitDict: DownloadProgressEventInit);
  readonly loaded: number;
}

export type CreateMonitor = EventTarget & {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
};

export interface TranslateOptions {
  signal?: AbortSignal;
}

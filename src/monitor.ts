import type { CreateMonitorCallback, DownloadProgressEventInit } from "./types.ts";

export class DownloadProgressEvent extends Event {
  readonly loaded: number;

  constructor(type: string, eventInitDict: DownloadProgressEventInit) {
    const { loaded, ...eventInit } = eventInitDict;
    super(type, eventInit);
    this.loaded = loaded;
  }
}

export class CreateMonitorImpl extends EventTarget {
  emitProgress(loaded: number): void {
    this.dispatchEvent(new DownloadProgressEvent("downloadprogress", { loaded }));
  }
}

export function buildMonitor(callback: CreateMonitorCallback | undefined): CreateMonitorImpl {
  const monitor = new CreateMonitorImpl();
  if (callback) {
    callback(monitor as unknown as Parameters<CreateMonitorCallback>[0]);
  }
  return monitor;
}

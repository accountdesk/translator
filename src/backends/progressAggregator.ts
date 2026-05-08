// Transformers.js' progress_callback fires events per file:
//   { status: 'initiate', file, name }
//   { status: 'download', file, name }
//   { status: 'progress', file, progress: 0..100, loaded, total }
//   { status: 'done', file }
//   { status: 'ready', model, task }
//
// A single MarianMT model load involves multiple files (config, tokenizer,
// vocabulary, weights, generation config). Surfacing the per-file progress
// directly would make the bar bounce back to 0 between files. We aggregate
// here: track each file's loaded / total bytes and emit the global ratio.

interface ProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

interface FileEntry {
  loaded: number;
  total: number;
  done: boolean;
}

export class ProgressAggregator {
  #files = new Map<string, FileEntry>();
  #emit: (loaded: number) => void;
  #lastEmitted = -1;

  constructor(emit: (loaded: number) => void) {
    this.#emit = emit;
  }

  ingest(payload: unknown): void {
    const event = payload as ProgressEvent;
    const file = event.file;

    if (event.status === "ready") {
      // Final signal — make sure we don't get stuck below 1.0 if the upstream
      // never sent a per-file 'done' (some Transformers.js code paths skip it
      // when the file was already cached).
      this.#emitIfChanged(1);
      return;
    }

    if (!file) return;

    const existing = this.#files.get(file);

    if (event.status === "initiate" || event.status === "download") {
      if (!existing) {
        this.#files.set(file, { loaded: 0, total: 0, done: false });
      }
      return;
    }

    if (event.status === "progress") {
      const loaded = event.loaded ?? 0;
      const total = event.total ?? existing?.total ?? 0;
      this.#files.set(file, { loaded, total, done: false });
      this.#recompute();
      return;
    }

    if (event.status === "done") {
      const total = existing?.total ?? event.total ?? 0;
      this.#files.set(file, { loaded: total, total, done: true });
      this.#recompute();
      return;
    }
  }

  #recompute(): void {
    let loaded = 0;
    let total = 0;
    for (const entry of this.#files.values()) {
      loaded += entry.loaded;
      total += entry.total;
    }
    if (total <= 0) return; // nothing to ratio yet
    this.#emitIfChanged(Math.max(0, Math.min(1, loaded / total)));
  }

  #emitIfChanged(value: number): void {
    // Avoid spamming consumers with identical 0.x values when the same file
    // is reported multiple times mid-download. Round to 1/1000 for the
    // dedup key but emit the precise value.
    const key = Math.round(value * 1000);
    if (key === this.#lastEmitted) return;
    this.#lastEmitted = key;
    this.#emit(value);
  }
}

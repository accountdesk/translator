import { expect, test } from "vite-plus/test";
import { ProgressAggregator } from "../../src/backends/progressAggregator.ts";

function recorder(): { emitted: number[]; emit: (v: number) => void } {
  const emitted: number[] = [];
  return { emitted, emit: (v) => emitted.push(v) };
}

test("aggregates loaded / total across multiple files", () => {
  const r = recorder();
  const agg = new ProgressAggregator(r.emit);

  agg.ingest({ status: "initiate", file: "config.json" });
  agg.ingest({ status: "initiate", file: "model.onnx" });

  agg.ingest({ status: "progress", file: "config.json", loaded: 50, total: 100 });
  expect(r.emitted.at(-1)).toBe(0.5); // 50/100, second file unknown size

  agg.ingest({ status: "progress", file: "model.onnx", loaded: 100, total: 900 });
  expect(r.emitted.at(-1)).toBeCloseTo((50 + 100) / (100 + 900)); // 0.15

  agg.ingest({ status: "progress", file: "model.onnx", loaded: 900, total: 900 });
  expect(r.emitted.at(-1)).toBe((50 + 900) / (100 + 900)); // 0.95

  agg.ingest({ status: "done", file: "model.onnx" });
  agg.ingest({ status: "progress", file: "config.json", loaded: 100, total: 100 });
  agg.ingest({ status: "done", file: "config.json" });
  expect(r.emitted.at(-1)).toBe(1);
});

test("'ready' forces 1.0 even when no per-file progress was reported (cache hit)", () => {
  const r = recorder();
  const agg = new ProgressAggregator(r.emit);

  agg.ingest({ status: "ready", model: "Xenova/opus-mt-en-de" });
  expect(r.emitted).toEqual([1]);
});

test("dedups identical values to avoid spamming the consumer", () => {
  const r = recorder();
  const agg = new ProgressAggregator(r.emit);

  agg.ingest({ status: "progress", file: "a.bin", loaded: 50, total: 100 });
  agg.ingest({ status: "progress", file: "a.bin", loaded: 50, total: 100 });
  agg.ingest({ status: "progress", file: "a.bin", loaded: 50, total: 100 });

  expect(r.emitted).toEqual([0.5]);
});

test("ignores events without a file (apart from 'ready')", () => {
  const r = recorder();
  const agg = new ProgressAggregator(r.emit);

  agg.ingest({ status: "progress", loaded: 1, total: 2 });
  agg.ingest({ status: "download" });
  expect(r.emitted).toEqual([]);
});

test("clamps emitted values into [0, 1]", () => {
  const r = recorder();
  const agg = new ProgressAggregator(r.emit);

  // Pathological upstream — loaded > total.
  agg.ingest({ status: "progress", file: "x.bin", loaded: 300, total: 100 });
  expect(r.emitted.at(-1)).toBe(1);
});

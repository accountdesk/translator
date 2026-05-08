import { expect, test } from "vite-plus/test";
import {
  type WorkerInbound,
  type WorkerLike,
  type WorkerOutbound,
  WorkerClient,
} from "../../src/workerClient.ts";

class FakeWorker implements WorkerLike {
  messageListeners: ((event: { data: WorkerOutbound }) => void)[] = [];
  errorListeners: ((event: ErrorEvent) => void)[] = [];
  messageErrorListeners: ((event: Event) => void)[] = [];
  posted: WorkerInbound[] = [];
  terminated = false;

  postMessage(message: WorkerInbound): void {
    this.posted.push(message);
  }

  addEventListener(type: "message" | "error" | "messageerror", listener: unknown): void {
    if (type === "message") this.messageListeners.push(listener as never);
    else if (type === "error") this.errorListeners.push(listener as never);
    else this.messageErrorListeners.push(listener as never);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerOutbound): void {
    for (const l of this.messageListeners) l({ data: message });
  }

  emitError(message: string): void {
    for (const l of this.errorListeners) l({ message } as ErrorEvent);
  }
}

test("call resolves with the worker result", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const promise = client.call<string>("ping", undefined);

  expect(fake.posted).toHaveLength(1);
  const sent = fake.posted[0]!;
  expect(sent).toMatchObject({ method: "ping" });
  fake.emit({ id: (sent as { id: number }).id, result: "pong" });

  expect(await promise).toBe("pong");
});

test("call rejects with the worker error mapped to DOMException", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const promise = client.call("explode", null);

  fake.emit({ id: 0, error: { name: "OperationError", message: "kaboom" } });

  await expect(promise).rejects.toMatchObject({ name: "OperationError", message: "kaboom" });
});

test("call routes progress messages to onProgress callback", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const observed: unknown[] = [];
  const promise = client.call<number>("download", null, {
    onProgress: (p) => observed.push(p),
  });

  fake.emit({ id: 0, progress: { loaded: 0.25 } });
  fake.emit({ id: 0, progress: { loaded: 0.75 } });
  fake.emit({ id: 0, result: 42 });

  expect(await promise).toBe(42);
  expect(observed).toEqual([{ loaded: 0.25 }, { loaded: 0.75 }]);
});

test("aborting the signal sends an abort message and rejects with AbortError", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const ac = new AbortController();
  const promise = client.call("translate", "hi", { signal: ac.signal });

  ac.abort();

  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(fake.posted).toContainEqual({ id: 0, abort: true });
});

test("pre-aborted signal rejects synchronously without posting", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const ac = new AbortController();
  ac.abort();

  await expect(client.call("translate", "hi", { signal: ac.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fake.posted).toHaveLength(0);
});

test("terminate fails all in-flight calls and rejects further calls", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const inflight = client.call("translate", "x");

  client.terminate();
  expect(fake.terminated).toBe(true);
  await expect(inflight).rejects.toMatchObject({ name: "OperationError" });
  await expect(client.call("translate", "y")).rejects.toMatchObject({ name: "InvalidStateError" });
});

test("worker error fails all in-flight calls", async () => {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake);
  const inflight = client.call("translate", "x");

  fake.emitError("boom");

  await expect(inflight).rejects.toMatchObject({ name: "OperationError", message: "boom" });
});

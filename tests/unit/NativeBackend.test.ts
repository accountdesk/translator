import { afterEach, expect, test, vi } from "vite-plus/test";
import { NativeBackend } from "../../src/backends/NativeBackend.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("availability returns 'unavailable' when window.Translator is missing", async () => {
  expect(await NativeBackend.availability({ sourceLanguage: "en", targetLanguage: "de" })).toBe(
    "unavailable",
  );
});

test("availability passes opts through to native API", async () => {
  const spy = vi.fn(async () => "available" as const);
  vi.stubGlobal("Translator", { availability: spy, create: vi.fn() });

  const result = await NativeBackend.availability({ sourceLanguage: "en", targetLanguage: "de" });

  expect(result).toBe("available");
  expect(spy).toHaveBeenCalledWith({ sourceLanguage: "en", targetLanguage: "de" });
});

test("availability swallows errors and returns 'unavailable'", async () => {
  vi.stubGlobal("Translator", {
    availability: () => Promise.reject(new Error("permission denied")),
    create: vi.fn(),
  });

  expect(await NativeBackend.availability({ sourceLanguage: "en", targetLanguage: "de" })).toBe(
    "unavailable",
  );
});

test("create wraps the native instance and forwards translate", async () => {
  const nativeInstance = {
    inputQuota: 1024,
    sourceLanguage: "en",
    targetLanguage: "de",
    translate: vi.fn(async (input: string) => `[${input}]`),
    translateStreaming: vi.fn(),
    measureInputUsage: vi.fn(async () => 5),
    destroy: vi.fn(),
  };
  vi.stubGlobal("Translator", {
    availability: vi.fn(),
    create: vi.fn(async () => nativeInstance),
  });

  const instance = await NativeBackend.create({ sourceLanguage: "en", targetLanguage: "de" });

  expect(instance.inputQuota).toBe(1024);
  expect(instance.sourceLanguage).toBe("en");
  expect(instance.targetLanguage).toBe("de");
  expect(await instance.translate("hi")).toBe("[hi]");
});

test("create re-emits native downloadprogress through our monitor", async () => {
  let nativeListener: ((event: { loaded: number }) => void) | undefined;
  const nativeMonitor = {
    addEventListener: (_type: string, listener: (event: { loaded: number }) => void) => {
      nativeListener = listener;
    },
  };
  vi.stubGlobal("Translator", {
    availability: vi.fn(),
    create: vi.fn(async (opts: { monitor?: (m: typeof nativeMonitor) => void }) => {
      opts.monitor?.(nativeMonitor);
      return {
        inputQuota: 0,
        sourceLanguage: "en",
        targetLanguage: "de",
        translate: vi.fn(),
        translateStreaming: vi.fn(),
        measureInputUsage: vi.fn(),
        destroy: vi.fn(),
      };
    }),
  });

  const observed: number[] = [];
  await NativeBackend.create({
    sourceLanguage: "en",
    targetLanguage: "de",
    monitor(m) {
      m.addEventListener("downloadprogress", (event) => observed.push(event.loaded));
    },
  });

  nativeListener?.({ loaded: 0.5 });
  nativeListener?.({ loaded: 1.0 });
  expect(observed).toEqual([0.5, 1.0]);
});

test("create rejects with NotSupportedError when window.Translator is missing", async () => {
  await expect(
    NativeBackend.create({ sourceLanguage: "en", targetLanguage: "de" }),
  ).rejects.toMatchObject({ name: "NotSupportedError" });
});

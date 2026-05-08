import { expect, test } from "vite-plus/test";
import { mergeAvailability } from "../../src/utils/mergeAvailability.ts";

test("returns 'unavailable' when called with no arguments", () => {
  expect(mergeAvailability()).toBe("unavailable");
});

test("'available' wins over everything", () => {
  expect(mergeAvailability("downloadable", "available")).toBe("available");
  expect(mergeAvailability("downloading", "available")).toBe("available");
  expect(mergeAvailability("unavailable", "available")).toBe("available");
});

test("'downloading' beats 'downloadable' and 'unavailable'", () => {
  expect(mergeAvailability("downloadable", "downloading")).toBe("downloading");
  expect(mergeAvailability("unavailable", "downloading")).toBe("downloading");
});

test("'downloadable' beats 'unavailable'", () => {
  expect(mergeAvailability("unavailable", "downloadable")).toBe("downloadable");
});

test("returns 'unavailable' when both are unavailable", () => {
  expect(mergeAvailability("unavailable", "unavailable")).toBe("unavailable");
});

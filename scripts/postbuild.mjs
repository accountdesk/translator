// Inlines the built worker into dist/bundle.js by replacing the
// `__INLINE_WORKER_BASE64__` placeholder with a base64-encoded copy of the
// worker file. Runs after `vp pack` (see the `build` script in package.json).
import { readFileSync, statSync, writeFileSync } from "node:fs";

const WORKER_PATH = "dist/worker.js";
const BUNDLE_PATH = "dist/bundle.js";
const PLACEHOLDER = "__INLINE_WORKER_BASE64__";

const worker = readFileSync(WORKER_PATH, "utf8");
const b64 = Buffer.from(worker, "utf8").toString("base64");

const bundle = readFileSync(BUNDLE_PATH, "utf8");
if (!bundle.includes(PLACEHOLDER)) {
  console.error(`Placeholder ${PLACEHOLDER} not found in ${BUNDLE_PATH}. Did the build run?`);
  process.exit(1);
}
const occurrences = bundle.split(PLACEHOLDER).length - 1;
if (occurrences !== 1) {
  console.error(`Expected exactly 1 placeholder, found ${occurrences}.`);
  process.exit(1);
}

writeFileSync(BUNDLE_PATH, bundle.replace(PLACEHOLDER, b64));

const before = bundle.length;
const after = before + b64.length - PLACEHOLDER.length;
const workerKB = (statSync(WORKER_PATH).size / 1024).toFixed(1);
const bundleKB = (after / 1024).toFixed(1);
console.log(
  `postbuild: inlined ${workerKB} KB of worker (${b64.length} base64 chars) into ${BUNDLE_PATH}; bundle is now ${bundleKB} KB.`,
);

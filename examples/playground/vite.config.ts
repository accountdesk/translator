import { defineConfig } from "vite-plus";

export default defineConfig({
  optimizeDeps: {
    // Don't pre-bundle the workspace library — it carries a 500 KB worker
    // and we want each iteration to use the freshly built `dist/`.
    exclude: ["@accountdesk/translator", "@accountdesk/translator/bundle"],
  },
});

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".open-next/**"],
    // Some E2EE stream tests deliberately push multi-megabyte payloads
    // (real CHUNK_SIZE boundaries) through AES-GCM; that's slow in this
    // environment's software crypto path, so the default 5s is too tight.
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url),
      ),
    },
    tsconfigPaths: true,
  },
  test: {
    // Keep durable budget histories from competing with SQL fixtures for disk time.
    maxWorkers: 1,
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});

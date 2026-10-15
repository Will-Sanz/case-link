import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

export default defineConfig({ ...base, test: { ...base.test,
  include: ["tests/ai/*.live.ts"], testTimeout: 3_600_000, hookTimeout: 30_000,
  maxWorkers: 1, fileParallelism: false,
} });

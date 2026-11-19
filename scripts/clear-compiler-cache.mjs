import { rmSync } from "node:fs";
// Remove compiler caches from older builds; they may contain server environment values.
for (const path of [".next/cache/turbopack", ".next/dev/cache/turbopack"]) rmSync(path, { recursive: true, force: true });

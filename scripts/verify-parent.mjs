import { spawnSync } from "node:child_process";
import { parentTestEnvironment } from "./parent-test-environment.mjs";
const env = parentTestEnvironment();
const command = process.argv.includes("--build") ? "build" : "verify";
const result = spawnSync("npm", ["run", command], { env, stdio: "inherit" });
process.exit(result.status ?? 1);

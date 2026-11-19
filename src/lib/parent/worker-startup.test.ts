import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const loader=createRequire(import.meta.url).resolve("tsx");
const env: NodeJS.ProcessEnv={ PATH:process.env.PATH,NODE_ENV:"test",NO_COLOR:"1" };
it("imports the actual worker runtime in plain Node without web-only module aliases or network access",()=>{
  const child=spawnSync(process.execPath,["--import",loader,"--input-type=module","-e",
    "globalThis.fetch=()=>{throw new Error('unexpected network')};await import('./src/lib/parent/worker-runtime.ts');process.stdout.write('worker runtime loaded')"],
    { cwd:process.cwd(),env,encoding:"utf8",timeout:15000 });
  expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stdout).toBe("worker runtime loaded"); expect(child.stderr).toBe("");
});
it("reaches the existing sanitized configuration rejection before any database or model work",()=>{
  const child=spawnSync(process.execPath,["--import",loader,resolve("scripts/parent-support-worker.ts")],{ cwd:process.cwd(),env,encoding:"utf8",timeout:15000 });
  expect(child.error).toBeUndefined(); expect(child.status).toBe(1); expect(child.stdout).toBe("");
  expect(child.stderr).toBe("The isolated parent worker could not run. Inspect its protected configuration and current authority.\n");
});

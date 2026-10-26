import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  connectedServicesSchema,
  connectedServiceEnvironment,
} from "./parent-connected-services-environment";

async function main() {
  const path = realpathSync(
    process.env.CASELINK_PARENT_CONNECTED_SERVICES_FILE ??
      "tmp/parent-runtime/connected-services-private.json",
  );
  const info = statSync(path);
  if (
    !path.startsWith(realpathSync(resolve("tmp/parent-runtime")) + sep) ||
    !info.isFile() ||
    (info.mode & 0o777) !== 0o600 ||
    info.uid !== process.getuid?.()
  )
    throw new Error(
      "Use an owner-only private runtime file inside parent-runtime.",
    );
  const config = connectedServicesSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  const remaining = Date.parse(config.approvedUntil) - Date.now();
  if (remaining <= 0 || remaining > 25 * 60 * 60 * 1000)
    throw new Error(
      "The explicitly approved private-service window is unavailable.",
    );
  const workerEnv = connectedServiceEnvironment("worker", config, process.env);
  const brokerEnv = connectedServiceEnvironment("broker", config, process.env);
  const retentionEnv = connectedServiceEnvironment(
    "retention",
    config,
    process.env,
  );
  const children = new Set<ChildProcess>();
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, stop);
  const start = (script: string, env: NodeJS.ProcessEnv, watch = false) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, ...(watch ? ["--watch"] : [])],
      { env, stdio: "inherit" },
    );
    children.add(child);
    child.once("exit", () => children.delete(child));
    child.once("error", stop);
    return child;
  };
  const deadline = setTimeout(stop, remaining);
  let retention: ChildProcess | null = null;
  let retentionTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const broker = start("scripts/parent-storage-broker.ts", brokerEnv);
    broker.once("exit", () => {
      if (!stopping) stop();
    });
    let ready = false;
    for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:3310/health", {
          headers: { authorization: `Bearer ${config.brokerSecret}` },
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && (await response.json()).ready === true;
      } catch {
        ready = false;
      }
      if (ready) break;
      await delay(500);
    }
    if (!ready)
      throw new Error("The private storage broker did not become ready.");
    const worker = start("scripts/parent-support-worker.ts", workerEnv, true);
    const runRetention = () => {
      if (retention || stopping) return;
      retention = start("scripts/parent-support-retention.ts", retentionEnv);
      retention.once("exit", () => {
        retention = null;
      });
    };
    runRetention();
    retentionTimer = setInterval(runRetention, 5 * 60 * 1000);
    process.stdout.write(
      "Approved private parent planning, assistant and retention services are running on loopback. No partner transport is enabled.\n",
    );
    const code = await new Promise<number | null>((resolve) =>
      worker.once("exit", resolve),
    );
    if (!stopping && code !== 0)
      throw new Error("The private worker stopped unexpectedly.");
  } finally {
    if (retentionTimer) clearInterval(retentionTimer);
    clearTimeout(deadline);
    stop();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Private parent services could not continue. Inspect the protected runtime; no secret or household detail is logged here.\n",
  );
  process.exitCode = 1;
});

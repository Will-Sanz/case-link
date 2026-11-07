import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostedParentProtectedFrontdoor } from "../src/lib/parent/protected-frontdoor";
import { createSnapProtectedReviewServer } from "../src/lib/parent/snap-protected-review";
import { senderServer } from "./parent-snap-services";
import { cleanupHostedParsers } from "./parent-hosted-parser-cleanup";
import { HOSTED_PORTS, HOSTED_UNAVAILABLE, hostedChildEnvironment, readHostedProfile, stopAtHostedDeadline, type HostedProfile } from "./parent-hosted-profile";

export function hostedWebFingerprint(config: HostedProfile): string {
  if (config.service !== "web") throw new Error(HOSTED_UNAVAILABLE);
  const env = hostedChildEnvironment(config, { NODE_ENV: "production" });
  // Operational expiry can change independently, but every setting compiled into Next must match.
  delete env.CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE; delete env.CASELINK_PARENT_HOSTED_APPROVED_UNTIL;
  return createHash("sha256").update(JSON.stringify(env)).digest("hex");
}
export function assertNoHostedDotenv(directory = process.cwd()) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
    if (existsSync(resolve(directory, name))) throw new Error(HOSTED_UNAVAILABLE);
}

async function main() {
  let config: HostedProfile;
  try {
    config = readHostedProfile(process.argv[2] ?? "", process.argv[3] === "parser-cleanup" ? "parser-cleanup" : "run");
    if (process.argv[3] && !(process.argv[3] === "build" && config.service === "web") && !(process.argv[3] === "parser-cleanup" && config.service === "worker")) throw new Error();
    assertNoHostedDotenv();
  } catch { process.stderr.write(HOSTED_UNAVAILABLE + "\n"); process.exitCode = 78; return; }
  if (process.argv[3] === "parser-cleanup" && config.service === "worker") { await cleanupHostedParsers(config); return; }
  const build = process.argv[3] === "build";
  if (["frontdoor", "review", "sender"].includes(config.service)) {
    const server = config.service === "frontdoor"
      ? createHostedParentProtectedFrontdoor(config.publicOrigin, "http://127.0.0.1:3100", "http://127.0.0.1:3400")
      : config.service === "review" ? createSnapProtectedReviewServer({ mode: "hosted", publicOrigin: config.publicOrigin,
        supabaseOrigin: config.projectOrigin, supabasePublicKey: config.publicKey, finalizerDatabaseUrl: config.databaseUrl })
        : config.service === "sender" ? senderServer("http://127.0.0.1:3500", config.senderSecret, config.databaseUrl, config.carrier) : undefined;
    if (!server || !["frontdoor", "review", "sender"].includes(config.service)) throw new Error();
    let stopping = false, cancel = () => {};
    const stop = () => { if (stopping) return; stopping = true; cancel(); server.close(); server.closeAllConnections(); };
    cancel = stopAtHostedDeadline(config.approvedUntil, stop);
    server.maxConnections = 8;
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
    server.once("error", () => { stop(); process.stderr.write(HOSTED_UNAVAILABLE + "\n"); process.exitCode = 1; });
    const port = HOSTED_PORTS[config.service as "frontdoor" | "review" | "sender"];
    if (!stopping) server.listen(port, "127.0.0.1");
    return;
  }
  const marker = "tmp/parent-hosted-build.json";
  if (config.service === "web" && !build) {
    try {
      const saved = JSON.parse(readFileSync(marker, "utf8"));
      if (saved.fingerprint !== hostedWebFingerprint(config) || saved.buildId !== readFileSync(".next/BUILD_ID", "utf8").trim()) throw new Error();
    } catch { process.stderr.write(HOSTED_UNAVAILABLE + "\n"); process.exitCode = 78; return; }
  }
  const args = build ? ["run", "build"] : config.service === "web" ? ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"]
    : ["--import", "tsx", config.service === "worker" ? "scripts/parent-support-worker.ts"
      : config.service === "broker" ? "scripts/parent-storage-broker.ts" : "scripts/parent-support-retention.ts", ...(config.service === "worker" ? ["--watch"] : [])];
  const child = spawn(build ? "npm" : process.execPath, args, { env: hostedChildEnvironment(config), stdio: "inherit", detached: true });
  let cancel = () => {};
  let stopping = false, killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (signal: NodeJS.Signals) => {
    if (child.pid) try { process.kill(-child.pid, signal); } catch { /* The process group already exited. */ }
  };
  const stop = () => {
    if (stopping) return; stopping = true; cancel(); terminate("SIGTERM");
    killTimer = setTimeout(() => terminate("SIGKILL"), 5000);
  };
  cancel = stopAtHostedDeadline(config.approvedUntil, stop);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
  child.once("exit", (code) => {
    cancel(); clearTimeout(killTimer);
    if (build && code === 0) {
      // tmp is an explicitly writable build directory; the release is read-only at runtime.
      try { mkdirSync("tmp", { recursive: true }); writeFileSync(marker, JSON.stringify({ fingerprint: hostedWebFingerprint(config), buildId: readFileSync(".next/BUILD_ID", "utf8").trim() }), { mode: 0o600 }); }
      catch { process.exitCode = 1; return; }
    }
    process.exitCode = stopping ? 0 : code ?? 1;
  });
  child.once("error", () => { cancel(); clearTimeout(killTimer); process.stderr.write(HOSTED_UNAVAILABLE + "\n"); process.exitCode = 1; });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch(() => { process.stderr.write(HOSTED_UNAVAILABLE + "\n"); process.exitCode = 1; });

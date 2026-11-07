import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HOSTED_PROJECT } from "./parent-hosted-profile";
const paths: string[] = [], children: ChildProcess[] = [];
afterEach(() => { for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL"); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function launch(seconds: number, enabled = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "caselink-hosted-process-"))); paths.push(dir); chmodSync(dir, 0o700);
  for (const name of ["node_modules", "src", "scripts", "tsconfig.json"]) symlinkSync(resolve(name), join(dir, name));
  const config = join(dir, "profile.json");
  writeFileSync(config, JSON.stringify({ service: "frontdoor", enabled, publicOrigin: "https://pilot.thecaselink.com", projectOrigin: HOSTED_PROJECT,
    approvalReference: "synthetic process shutdown test", approvedUntil: new Date(Date.now() + seconds * 1000).toISOString() }), { mode: 0o600 });
  const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/parent-hosted-services.ts"), config], {
    cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production" }, stdio: "pipe" });
  children.push(child); let stderr = ""; child.stderr?.on("data", chunk => { stderr += chunk; });
  return { child, exited: once(child, "exit"), stderr: () => stderr };
}
async function ready(child: ChildProcess) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("Hosted fixture exited before listening");
    const connected = await new Promise<boolean>(resolve => {
      const socket = connect(3200, "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Hosted fixture did not listen");
}
describe.sequential("actual hosted frontdoor process without upstreams or credentials", () => {
  it("exits78 before listening for a disabled profile", async () => {
    const run = launch(60, false); expect((await run.exited)[0]).toBe(78); expect(run.stderr()).toContain("disabled, expired, or not configured");
  });
  it("closes the fixed loopback listener on SIGTERM", async () => {
    const run = launch(60); await ready(run.child); run.child.kill("SIGTERM"); expect((await run.exited)[0]).toBe(0); expect(run.stderr()).toBe("");
  });
  it("closes the listener at the original operating deadline", async () => {
    const start = Date.now(), run = launch(4); await ready(run.child); expect((await run.exited)[0]).toBe(0);
    expect(Date.now() - start).toBeGreaterThanOrEqual(3900); expect(Date.now() - start).toBeLessThan(7000); expect(run.stderr()).toBe("");
  }, 10000);
});

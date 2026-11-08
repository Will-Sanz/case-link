import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { HOSTED_UNAVAILABLE, type HostedProfile } from "./parent-hosted-profile";

const execute = promisify(execFile);
/** The daemon is dedicated and rootless; names alone are not authority to remove another container. */
export async function cleanupHostedParsers(config: Extract<HostedProfile, { service: "worker" }>,
  run: (args: string[], env: NodeJS.ProcessEnv) => Promise<string> = async (args, env) =>
    (await execute("docker", args, { env, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 16384 })).stdout,
  system: NodeJS.ProcessEnv = process.env): Promise<void> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: system.PATH, HOME: system.HOME, DOCKER_HOST: config.dockerHost };
  try {
    const info = (await run(["info", "--format", "{{json .ID}}\n{{json .SecurityOptions}}"], env)).trim().split("\n");
    if (info.length !== 2 || JSON.parse(info[0]) !== config.parserDaemonId
      || !z.array(z.string()).parse(JSON.parse(info[1])).includes("name=rootless")) throw new Error();
    const rows = (await run(["ps", "--all", "--no-trunc", "--filter", "name=^/caselink-document-", "--format", "{{json .}}"], env)).trim();
    const ids: string[] = [];
    for (const line of rows ? rows.split("\n") : []) {
      const row = z.object({ ID: z.string().regex(/^[a-f0-9]{64}$/), Names: z.string(), Image: z.string() }).parse(JSON.parse(line));
      if (!/^caselink-document-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.Names)) continue;
      if (row.Image !== config.parserImage || ids.length >= 16) throw new Error();
      ids.push(row.ID);
    }
    if (ids.length) await run(["rm", "--force", ...ids], env);
  } catch { throw new Error(HOSTED_UNAVAILABLE); }
}

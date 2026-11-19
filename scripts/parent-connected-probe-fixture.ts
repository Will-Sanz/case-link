import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";

const probeSchema = z
  .object({
    purpose: z.literal("caselink-connected-synthetic-probe"),
    projectUrl: z.literal("https://zpfypkizsapvsxeykmdq.supabase.co"),
    origin: z.literal("http://127.0.0.1:3200"),
    authUserId: z.uuid(),
    email: z
      .string()
      .regex(
        /^parent-connected-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@example\.test$/,
      ),
    password: z.string().min(16).max(128),
  })
  .strict();

export function validateConnectedProbeFixture(value: unknown) {
  const result = probeSchema.safeParse(value);
  if (!result.success)
    throw new Error("An exact disposable connected probe fixture is required.");
  return result.data;
}

export function readConnectedProbeFixture(path: string) {
  const actual = realpathSync(path);
  const stat = statSync(actual);
  if (
    !actual.startsWith(resolve("tmp") + sep) ||
    !stat.isFile() ||
    stat.size > 16384 ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error(
      "Keep the disposable probe credential file private inside this project's tmp directory.",
    );
  return validateConnectedProbeFixture(
    JSON.parse(readFileSync(actual, "utf8")),
  );
}

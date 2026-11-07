import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { brokerS3Credentials } from "./parent-storage-broker";

const env = { CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID: "synthetic-s3-access-id",
  CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: "synthetic-s3-secret-at-least-20", CASELINK_PARENT_STORAGE_BROKER_S3_REGION: "local" };
describe("Storage-only broker startup credentials", () => {
  it("uses explicit S3 credentials without a project API key", () => {
    expect(brokerS3Credentials(env)).toEqual({ s3AccessKeyId: env.CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID,
      s3SecretAccessKey: env.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY, s3Region: "local" });
  });
  it.each(["CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"])("rejects a broad credential even alongside valid S3 fields: %s", name => {
    expect(() => brokerS3Credentials({ ...env, [name]: "synthetic-broad-key" })).toThrow("Project API credentials");
  });
  it("does not fall back to a project key or ambient AWS credentials", () => {
    expect(() => brokerS3Credentials({ AWS_ACCESS_KEY_ID: "synthetic", AWS_SECRET_ACCESS_KEY: "synthetic-secret-at-least-20" })).toThrow();
    expect(() => brokerS3Credentials({ ...env, CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: undefined })).toThrow();
  });
  it("runs its sanitized invalid-configuration handler when invoked from another directory", () => {
    const child = spawnSync(process.execPath, ["--import",createRequire(import.meta.url).resolve("tsx"),fileURLToPath(new URL("./parent-storage-broker.ts",import.meta.url))],
      { cwd: tmpdir(), encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
    expect(child.status).toBe(1);expect(child.stderr).toContain("The isolated parent storage broker could not start.");
    expect(child.stderr).not.toMatch(/TypeError|import\.meta|undefined|ERR_INVALID_ARG_TYPE/);
  });
});

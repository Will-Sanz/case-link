import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { publicKeyIsSafe, parentConfigurationIssues } from "../src/lib/parent/configuration";
import { hostedParentServiceAllowed } from "../src/lib/parent/hosted-service";
import { snapSenderCarrierConfigSchema } from "../src/lib/parent/snap-sender-carrier";
import { s3StorageCredentialsSchema } from "../src/lib/parent/storage-s3";

export const HOSTED_PROJECT = "https://zpfypkizsapvsxeykmdq.supabase.co";
export const HOSTED_PORTS = { web: 3100, frontdoor: 3200, broker: 3310, review: 3400, sender: 3500 } as const;
const secret = z.string().regex(/^[\x21-\x7e]{32,256}$/);
const publicKey = z.string().min(1).max(4096).regex(/^[A-Za-z0-9._-]+$/).refine(publicKeyIsSafe);
const common = { enabled: z.boolean().default(false), approvalReference: z.string().trim().min(1).max(500),
  approvedUntil: z.iso.datetime({ offset: true }), publicOrigin: z.string().url().max(100), projectOrigin: z.literal(HOSTED_PROJECT) };
const databaseUrl = z.string().min(1).max(2048);
export const hostedProfileSchema = z.discriminatedUnion("service", [
  z.object({ ...common, service: z.literal("web"), publicKey, realDataApproved: z.boolean().default(false) }).strict(),
  z.object({ ...common, service: z.literal("frontdoor") }).strict(),
  z.object({ ...common, service: z.literal("worker"), databaseUrl, brokerSecret: secret, modelKey: z.string().min(1).max(512),
    parserImage: z.string().max(201).regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/),
    dockerHost: z.string().regex(/^unix:\/\/\/run\/user\/[0-9]+\/docker\.sock$/),
    parserDaemonId: z.string().regex(/^[A-Za-z0-9:_.-]{16,128}$/),
    senderSecret: secret.optional() }).strict(),
  z.object({ ...common, service: z.literal("broker"), databaseUrl, brokerSecret: secret, storage: s3StorageCredentialsSchema }).strict(),
  z.object({ ...common, service: z.literal("review"), databaseUrl, publicKey, collectionApproved: z.boolean().default(false) }).strict(),
  z.object({ ...common, service: z.literal("sender"), databaseUrl, senderSecret: secret,
    sendingApproved: z.boolean().default(false), carrier: snapSenderCarrierConfigSchema }).strict(),
  z.object({ ...common, service: z.literal("retention"), databaseUrl }).strict(),
  z.object({ ...common, service: z.literal("ordinary-retention"), databaseUrl, storage: s3StorageCredentialsSchema }).strict(),
]);
export type HostedProfile = z.infer<typeof hostedProfileSchema>;
export const HOSTED_UNAVAILABLE = "The hosted service is disabled, expired, or not configured. No credentials or household information are logged.";

function authority(config: HostedProfile): Record<string, string> {
  return { CASELINK_PRODUCT: "parent", CASELINK_ENVIRONMENT: "production", CASELINK_PARENT_ACCOUNT_MODE: "existing",
    NEXT_PUBLIC_SITE_URL: config.publicOrigin, CASELINK_SCHOOL_SUPABASE_URL: config.projectOrigin,
    CASELINK_PARENT_PRODUCTION_SUPABASE_URL: config.projectOrigin, CASELINK_PARENT_HOSTED_APPROVED: "1",
    CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE: config.approvalReference, CASELINK_PARENT_HOSTED_APPROVED_UNTIL: config.approvedUntil };
}
export function parseHostedProfile(input: unknown, now = Date.now(), operation: "run" | "parser-cleanup" = "run"): HostedProfile {
  try {
    const config = hostedProfileSchema.parse(input);
    // Every role uses the same exact site/project checks, including roles with no database credential.
    const database = "databaseUrl" in config ? config.databaseUrl : "postgresql://caselink_validation:unused@db.zpfypkizsapvsxeykmdq.supabase.co/postgres?sslmode=verify-full";
    const cleanup = operation === "parser-cleanup";
    // Cleanup may outlive operating approval; it can only delete this worker's exact parser containers.
    if ((cleanup ? config.service !== "worker" : !config.enabled)
      || !hostedParentServiceAllowed(authority(config), database, config.projectOrigin, "http://127.0.0.1:3310", cleanup ? Date.parse(config.approvedUntil) - 1 : now)
      || (config.service === "web" && !config.realDataApproved)
      || (config.service === "review" && !config.collectionApproved)
      || (config.service === "sender" && !config.sendingApproved)) throw new Error();
    return config;
  } catch { throw new Error(HOSTED_UNAVAILABLE); }
}

/** Each service owns one 0600 file in its own 0700 directory, never a shared secret bundle. */
export function readHostedProfile(path: string, operation: "run" | "parser-cleanup" = "run"): HostedProfile {
  let fd: number | undefined;
  try {
    const target = resolve(path), parent = dirname(target), directory = lstatSync(parent);
    if (path !== target || !directory.isDirectory() || directory.isSymbolicLink() || realpathSync(parent) !== parent
      || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700) throw new Error();
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid?.() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600 || file.size <= 0 || file.size > 65536) throw new Error();
    return parseHostedProfile(JSON.parse(readFileSync(fd, "utf8")), Date.now(), operation);
  } catch { throw new Error(HOSTED_UNAVAILABLE); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Allowlist only: NODE_OPTIONS, dotenv secrets, provider and other roles' credentials never pass through. */
export function hostedChildEnvironment(config: HostedProfile, system: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: system.PATH, HOME: system.HOME, TMPDIR: system.TMPDIR, NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1", ...authority(config) };
  if (config.service === "web") {
    Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: config.projectOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publicKey,
      CASELINK_PARENT_REAL_DATA_APPROVED: "1", CASELINK_HSTS: "1", CASELINK_PARENT_EMAIL_CODE_ENABLED: "0",
      CASELINK_PARENT_RECOVERY_SITE_URL: "https://www.thecaselink.com", OPENAI_DEBUG: "0", OPENAI_PAYLOAD_DEBUG: "0",
      PLAN_REGENERATE_DEBUG: "0", PLAN_REFINE_DEBUG: "0" });
    if (parentConfigurationIssues(env).length) throw new Error(HOSTED_UNAVAILABLE);
  } else if (config.service === "worker") {
    Object.assign(env, { CASELINK_PARENT_WORKER_APPROVED: "1", CASELINK_PARENT_WORKER_DATABASE_URL: config.databaseUrl,
      CASELINK_PARENT_WORKER_SUPABASE_URL: config.projectOrigin, CASELINK_PARENT_STORAGE_BROKER_ORIGIN: "http://127.0.0.1:3310",
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret, OPENAI_API_KEY: config.modelKey,
      CASELINK_DOCUMENT_PARSER_IMAGE: config.parserImage, DOCKER_HOST: config.dockerHost,
      ...(config.senderSecret ? { CASELINK_PARENT_SNAP_SENDER_ORIGIN: "http://127.0.0.1:3500", CASELINK_PARENT_SNAP_SENDER_SECRET: config.senderSecret } : {}) });
  } else if (config.service === "broker") {
    Object.assign(env, { CASELINK_PARENT_STORAGE_BROKER_APPROVED: "1", CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL: config.databaseUrl,
      CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL: config.projectOrigin, CASELINK_PARENT_STORAGE_BROKER_ORIGIN: "http://127.0.0.1:3310",
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret, CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID: config.storage.s3AccessKeyId,
      CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: config.storage.s3SecretAccessKey, CASELINK_PARENT_STORAGE_BROKER_S3_REGION: config.storage.s3Region });
  } else if (config.service === "retention" || config.service === "ordinary-retention") {
    Object.assign(env, { CASELINK_PARENT_RETENTION_APPROVED: "1", CASELINK_PARENT_RETENTION_DATABASE_URL: config.databaseUrl,
      CASELINK_PARENT_RETENTION_SUPABASE_URL: config.projectOrigin, CASELINK_PARENT_RETENTION_MODE: config.service === "retention" ? "snap-packets" : "ordinary",
      CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED: "1", CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE: config.approvalReference,
      CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: config.approvedUntil });
    if (config.service === "ordinary-retention") Object.assign(env, {
      CASELINK_PARENT_RETENTION_S3_ACCESS_KEY_ID: config.storage.s3AccessKeyId,
      CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY: config.storage.s3SecretAccessKey,
      CASELINK_PARENT_RETENTION_S3_REGION: config.storage.s3Region,
    });
  }
  return env;
}

/** Rechecks the original deadline; long approvals never overflow Node's 32-bit timeout or renew themselves. */
export function stopAtHostedDeadline(until: string, stop: () => void, now = Date.now): () => void {
  const deadline = Date.parse(until);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => { const remaining = deadline - now(); if (!Number.isFinite(remaining) || remaining <= 0) stop();
    else timer = setTimeout(check, Math.min(remaining, 60_000)); };
  check(); return () => clearTimeout(timer);
}

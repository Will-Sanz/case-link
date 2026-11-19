import { z } from "zod";
import { connectedParentServiceAllowed } from "../src/lib/parent/connected-service";
import { s3StorageCredentialsSchema } from "../src/lib/parent/storage-s3";

export const connectedServicesSchema = z
  .object({
    projectUrl: z.url(),
    approvedUntil: z.iso.datetime({ offset: true }),
    workerDatabaseUrl: z.string().min(1),
    brokerDatabaseUrl: z.string().min(1),
    retentionDatabaseUrl: z.string().min(1),
    openaiApiKey: z.string().min(20),
    storageKey: z.string().min(20),
    ...s3StorageCredentialsSchema.shape,
    brokerSecret: z.string().min(32),
  })
  .strict();
export type ConnectedServices = z.infer<typeof connectedServicesSchema>;

export function connectedServiceEnvironment(
  service: "worker" | "broker" | "retention" | "browser",
  config: ConnectedServices,
  approval: Record<string, string | undefined>,
  system: Record<string, string | undefined> = process.env,
  browserPublicKey?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      ["PATH", "HOME", "TMPDIR"].map((key) => [key, system[key]]),
    ),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CASELINK_PRODUCT: "parent",
    CASELINK_ENVIRONMENT: "connected",
    CASELINK_PARENT_ACCOUNT_MODE: "existing",
    CASELINK_PARENT_CONNECTED_APPROVED:
      approval.CASELINK_PARENT_CONNECTED_APPROVED,
    CASELINK_PARENT_PRODUCTION_SUPABASE_URL:
      approval.CASELINK_PARENT_PRODUCTION_SUPABASE_URL,
    CASELINK_SCHOOL_SUPABASE_URL:
      approval.CASELINK_PARENT_PRODUCTION_SUPABASE_URL,
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
    OPENAI_DEBUG: "0",
    OPENAI_PAYLOAD_DEBUG: "0",
    PLAN_REGENERATE_DEBUG: "0",
    PLAN_REFINE_DEBUG: "0",
  };
  if (
    system.VERCEL ||
    ["production", "preview"].includes(system.VERCEL_ENV ?? "")
  )
    throw new Error(
      "Connected private services cannot run in a hosted deployment.",
    );
  const brokerOrigin = "http://127.0.0.1:3310";
  const databaseUrl =
    config[`${service === "browser" ? "worker" : service}DatabaseUrl`];
  if (
    !connectedParentServiceAllowed(
      env,
      databaseUrl,
      config.projectUrl,
      brokerOrigin,
    )
  )
    throw new Error(
      "The private service must use the approved existing database with verified TLS.",
    );
  if (service === "worker")
    Object.assign(env, {
      CASELINK_PARENT_WORKER_APPROVED: "1",
      CASELINK_PARENT_WORKER_DATABASE_URL: databaseUrl,
      CASELINK_PARENT_WORKER_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_STORAGE_BROKER_ORIGIN: brokerOrigin,
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret,
      OPENAI_API_KEY: config.openaiApiKey,
    });
  if (service === "broker")
    Object.assign(env, {
      CASELINK_PARENT_STORAGE_BROKER_APPROVED: "1",
      CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL: databaseUrl,
      CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID: config.s3AccessKeyId,
      CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: config.s3SecretAccessKey,
      CASELINK_PARENT_STORAGE_BROKER_S3_REGION: config.s3Region,
      CASELINK_PARENT_STORAGE_BROKER_ORIGIN: brokerOrigin,
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret,
    });
  if (service === "retention")
    Object.assign(env, {
      CASELINK_PARENT_RETENTION_APPROVED: "1",
      CASELINK_PARENT_RETENTION_DATABASE_URL: databaseUrl,
      CASELINK_PARENT_RETENTION_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_RETENTION_STORAGE_KEY: config.storageKey,
    });
  if (service === "browser")
    Object.assign(env, {
      CASELINK_PARENT_BROWSER_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_BROWSER_PUBLIC_KEY: browserPublicKey,
      CASELINK_PARENT_BROWSER_APPROVED_UNTIL: config.approvedUntil,
    });
  return env;
}

import { expect, it } from "vitest";
import {
  connectedServiceEnvironment,
  connectedServicesSchema,
} from "./parent-connected-services-environment";
it("separates each private principal and credential and never inherits the operator environment", () => {
  const project = "https://approved.supabase.co";
  const config = connectedServicesSchema.parse({
    projectUrl: project,
    approvedUntil: "2026-10-27T16:00:00Z",
    workerDatabaseUrl:
      "postgresql://worker:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full",
    brokerDatabaseUrl:
      "postgresql://broker:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full",
    retentionDatabaseUrl:
      "postgresql://retention:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full",
    openaiApiKey: "synthetic-private-model-key",
    storageKey: "synthetic-private-storage-key",
    brokerSecret: "separate-synthetic-broker-secret-32characters",
  });
  const approval = {
    CASELINK_PARENT_CONNECTED_APPROVED: "1",
    CASELINK_PARENT_PRODUCTION_SUPABASE_URL: project,
  };
  const inherited = {
    PATH: "system-path",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-inherit",
    RESEND_API_KEY: "must-not-inherit",
    OPENAI_API_KEY: "wrong-key",
    OPENAI_DEBUG: "1",
  };
  const worker = connectedServiceEnvironment(
    "worker",
    config,
    approval,
    inherited,
  );
  const broker = connectedServiceEnvironment(
    "broker",
    config,
    approval,
    inherited,
  );
  const retention = connectedServiceEnvironment(
    "retention",
    config,
    approval,
    inherited,
  );
  expect(worker.OPENAI_API_KEY).toBe(config.openaiApiKey);
  expect(worker.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY).toBeUndefined();
  expect(worker.CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL).toBeUndefined();
  expect(broker.OPENAI_API_KEY).toBeUndefined();
  expect(retention.OPENAI_API_KEY).toBeUndefined();
  expect(broker.CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL).toBe(
    config.brokerDatabaseUrl,
  );
  expect(retention.CASELINK_PARENT_RETENTION_DATABASE_URL).toBe(
    config.retentionDatabaseUrl,
  );
  for (const env of [worker, broker, retention]) {
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.OPENAI_DEBUG).toBe("0");
  }
  expect(() =>
    connectedServiceEnvironment("worker", config, {}, inherited),
  ).toThrow("approved");
  expect(() =>
    connectedServiceEnvironment("worker", config, approval, { VERCEL: "1" }),
  ).toThrow("hosted");
});

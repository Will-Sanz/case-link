import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runParentWorkerService } from "../src/lib/parent/worker-service";
import { createParentServiceDatabase, validateParentServiceDatabaseTarget } from "../src/lib/parent/service-database";
import { createUtilityProtectedPreparationClient } from "../src/lib/parent/utility-preparation-worker-client";
import { createSnapProtectedSubmissionClient } from "../src/lib/parent/snap-sender-worker-client";

export async function runParentSupportWorker(env: Record<string, string | undefined> = process.env, watch = process.argv.includes("--watch")) {
  const target = validateParentServiceDatabaseTarget(env, "worker");
  const { projectUrl: supabaseOrigin, brokerOrigin } = target;
  const brokerSecret = env.CASELINK_PARENT_STORAGE_BROKER_SECRET;
  if (!brokerSecret || brokerSecret.length < 32)
    throw new Error(
      "A scoped worker database, isolated parent origin and storage broker are required.",
    );
  const service = createParentServiceDatabase(target);
  const stop = () => service.close();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await service.connect();
    await Promise.race([runParentWorkerService({
      database: service.database,
      apiKey: env.OPENAI_API_KEY,
      brokerOrigin,
      brokerSecret,
      supabaseOrigin,
      watch,
      signal: service.signal,
      protectedSnapSubmission: env.CASELINK_PARENT_SNAP_SENDER_ORIGIN || env.CASELINK_PARENT_SNAP_SENDER_SECRET
        ? createSnapProtectedSubmissionClient({ origin: env.CASELINK_PARENT_SNAP_SENDER_ORIGIN ?? "", secret: env.CASELINK_PARENT_SNAP_SENDER_SECRET ?? "" }) : undefined,
      protectedUtilityPreparation: env.CASELINK_PARENT_UTILITY_PREPARATION_ORIGIN || env.CASELINK_PARENT_UTILITY_PREPARATION_SECRET
        ? createUtilityProtectedPreparationClient({ origin: env.CASELINK_PARENT_UTILITY_PREPARATION_ORIGIN ?? "", secret: env.CASELINK_PARENT_UTILITY_PREPARATION_SECRET ?? "" }) : undefined,
      notifications:
        env.CASELINK_PARENT_NOTIFICATIONS_APPROVED === "1" &&
        env.RESEND_API_KEY &&
        env.CASELINK_PARENT_EMAIL_FROM &&
        env.NEXT_PUBLIC_SITE_URL
          ? {
              apiKey: env.RESEND_API_KEY,
              from: env.CASELINK_PARENT_EMAIL_FROM,
              siteOrigin: env.NEXT_PUBLIC_SITE_URL,
              approved: true,
            }
          : undefined,
    }), service.stopped]);
    process.stdout.write(
      "The private support and assistant worker stopped. Only recorded receipts establish external delivery.\n",
    );
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    service.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void runParentSupportWorker().catch(() => {
  process.stderr.write(
    "The isolated parent worker could not run. Inspect its protected configuration and current authority.\n",
  );
  process.exitCode = 1;
});

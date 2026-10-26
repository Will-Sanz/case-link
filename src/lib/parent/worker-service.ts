import { setTimeout as delay } from "node:timers/promises";
import { runOneParentAssistantTurn } from "./assistant";
import { runOneParentNotification } from "./notification-runtime";
import { runOneParentJob, type WorkerRuntimeOptions } from "./worker-runtime";

/** The browser never drives this loop. Database leases and budgets bound each authorized turn. */
export async function runParentWorkerService(
  options: WorkerRuntimeOptions & {
    watch?: boolean;
    signal?: AbortSignal;
    notifications?: Omit<
      Parameters<typeof runOneParentNotification>[0],
      "database"
    >;
  },
): Promise<void> {
  const { database, apiKey, signal } = options;
  let planningReady = false,
    healthFailed = false;
  let heartbeat: Promise<void> | null = null;
  const reportHealth = async () => {
    planningReady = false;
    if (apiKey) {
      try {
        const response = await (options.fetcher ?? fetch)(
          new URL("/health", options.brokerOrigin),
          {
            headers: { authorization: `Bearer ${options.brokerSecret}` },
            signal: AbortSignal.timeout(3000),
          },
        );
        planningReady = response.ok && (await response.json()).ready === true;
      } catch {
        planningReady = false;
      }
    }
    await database.query(
      "select parent_private.parent_record_worker_health($1,$2)",
      [planningReady, Boolean(apiKey)],
    );
  };
  await reportHealth();
  const timer = options.watch
    ? setInterval(() => {
        if (heartbeat) return;
        heartbeat = reportHealth()
          .catch(() => {
            healthFailed = true;
          })
          .finally(() => {
            heartbeat = null;
          });
      }, 20000)
    : null;
  try {
    do {
      if (signal?.aborted || healthFailed) break;
      if (apiKey)
        await runOneParentAssistantTurn({
          database,
          apiKey,
          fetcher: options.fetcher,
          now: options.now,
        });
      if (signal?.aborted || healthFailed) break;
      if (planningReady) await runOneParentJob(options);
      if (!signal?.aborted && options.notifications)
        await runOneParentNotification({ ...options.notifications, database });
      if (!options.watch || signal?.aborted) break;
      try {
        await delay(5000, undefined, { signal });
      } catch (error) {
        if (!signal?.aborted) throw error;
      }
    } while (!signal?.aborted);
    if (healthFailed)
      throw new Error("The private worker health connection was lost.");
  } finally {
    if (timer) clearInterval(timer);
    await heartbeat;
    await database
      .query("select parent_private.parent_record_worker_health(false,false)")
      .catch(() => {});
  }
}

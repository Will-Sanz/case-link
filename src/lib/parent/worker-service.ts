import { setTimeout as delay } from "node:timers/promises";
import { runOneParentAssistantTurn } from "./assistant";
import { FOOD_DESCRIPTION_FINGERPRINT, foodDescriptionCatalogReady, foodDescriptionProjectIdSchema, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { runOneParentNotification } from "./notification-runtime";
import { runOneParentJob, type WorkerRuntimeOptions } from "./worker-runtime";

/** The browser never drives this loop. Database leases and budgets bound each authorized turn. */
export async function runParentWorkerService(
  options: WorkerRuntimeOptions & {
    foodDescriptionProjectId?: string;
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
      "select parent_private.parent_record_worker_health($1,$2,$3)",
      [planningReady, Boolean(apiKey), true],
    );
    await database.query("select parent_private.parent_record_food_description_health($1,$2,$3)", [Boolean(apiKey) && foodDescriptionProjectIdSchema.safeParse(options.foodDescriptionProjectId).success && foodDescriptionCatalogReady(options.now?.() ?? new Date()), FOOD_DESCRIPTION_FINGERPRINT, options.foodDescriptionProjectId ?? null]);
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
      await runOneParentJob({ ...options, continuationOnly: !planningReady });
      if (signal?.aborted || healthFailed) break;
      if (apiKey)
        await runOneParentAssistantTurn({
          database,
          apiKey,
          fetcher: options.fetcher,
          now: options.now,
        });
      if (signal?.aborted || healthFailed) break;
      if (apiKey) await runOneFoodDescriptionTurn({ database, apiKey, projectId: options.foodDescriptionProjectId, fetcher: options.fetcher, now: options.now });
      if (signal?.aborted || healthFailed) break;
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
    await database.query("select parent_private.parent_record_food_description_health(false,$1,$2)", [FOOD_DESCRIPTION_FINGERPRINT, options.foodDescriptionProjectId ?? null]).catch(() => {});
    await database
      .query("select parent_private.parent_record_worker_health(false,false,false)")
      .catch(() => {});
  }
}

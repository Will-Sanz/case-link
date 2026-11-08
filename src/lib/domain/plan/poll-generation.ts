import type { StagedPlanAdvanceResult } from "@/app/actions/plans";

function awaitRequest<T>(request: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); reject(new Error("Request interrupted")); };
    const timer = setTimeout(cancel, Math.min(310_000, Math.max(0, deadline - Date.now())));
    signal.addEventListener("abort", cancel, { once: true });
    request.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) cancel();
  });
}

/** Busy claims can outlive a browser request. Stop after twelve minutes with a manual resume. */
export async function pollPlanGeneration(
  advance: () => Promise<StagedPlanAdvanceResult>,
  refresh: () => Promise<void>,
  signal: AbortSignal,
): Promise<"complete" | "superseded" | "cancelled" | { error: string }> {
  const deadline = Date.now() + 12 * 60_000;
  let failures = 0;
  while (!signal.aborted && Date.now() < deadline) {
    let result: StagedPlanAdvanceResult;
    try {
      result = await awaitRequest(advance(), signal, deadline);
    } catch {
      result = { ok: false, status: "retryable", error: "Connection interrupted. You can continue this saved draft.", retryAfter: 5 };
    }
    if (signal.aborted) return "cancelled";
    try { await awaitRequest(refresh(), signal, deadline); } catch { /* The next poll can still confirm saved progress. */ }
    if (signal.aborted) return "cancelled";
    if (result.ok && result.done) return result.status;
    if (!result.ok && (result.status === "failed" || ++failures >= 3)) return { error: result.error };
    if (result.ok) failures = 0;
    const seconds = "retryAfter" in result ? result.retryAfter ?? 5 : 0.25;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, Math.min(Math.max(seconds, 0.25), 15) * 1000);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }
  return signal.aborted ? "cancelled" : { error: "Preparation is taking longer than expected. Your saved stages are safe. Continue the draft when you return." };
}

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ plan: vi.fn(), assistant: vi.fn() }));
vi.mock("./assistant", () => ({ runOneParentAssistantTurn: mocks.assistant }));
vi.mock("./worker-runtime", () => ({ runOneParentJob: mocks.plan }));
import { runParentWorkerService } from "./worker-service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan.mockResolvedValue({ state: "idle" });
  mocks.assistant.mockResolvedValue({ state: "idle" });
});
const options = () => ({
  database: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  apiKey: "synthetic-key",
  brokerOrigin: "http://127.0.0.1:3310",
  brokerSecret: "synthetic-private-broker-secret",
  supabaseOrigin: "https://approved.supabase.co",
  fetcher: vi.fn().mockResolvedValue(Response.json({ ready: true })),
});
it("reports only actual configured services and clears readiness when it stops", async () => {
  const input = options();
  await runParentWorkerService(input);
  expect(input.fetcher).toHaveBeenCalledWith(
    new URL("http://127.0.0.1:3310/health"),
    expect.objectContaining({
      headers: { authorization: `Bearer ${input.brokerSecret}` },
    }),
  );
  expect(input.database.query).toHaveBeenNthCalledWith(
    1,
    "select parent_private.parent_record_worker_health($1,$2)",
    [true, true],
  );
  expect(mocks.plan).toHaveBeenCalledTimes(1);
  expect(mocks.assistant).toHaveBeenCalledTimes(1);
  expect(mocks.plan.mock.invocationCallOrder[0]).toBeLessThan(mocks.assistant.mock.invocationCallOrder[0]);
  expect(input.database.query).toHaveBeenLastCalledWith(
    "select parent_private.parent_record_worker_health(false,false)",
  );
});
it("does not execute planning with an unavailable broker or any model work without a key", async () => {
  const input = options();
  input.fetcher.mockRejectedValue(new Error("offline"));
  await runParentWorkerService(input);
  expect(input.database.query).toHaveBeenNthCalledWith(
    1,
    "select parent_private.parent_record_worker_health($1,$2)",
    [false, true],
  );
  expect(mocks.plan).not.toHaveBeenCalled();
  expect(mocks.assistant).toHaveBeenCalledTimes(1);
  vi.clearAllMocks();
  await runParentWorkerService({ ...input, apiKey: undefined });
  expect(mocks.plan).not.toHaveBeenCalled();
  expect(mocks.assistant).not.toHaveBeenCalled();
  expect(input.fetcher).not.toHaveBeenCalled();
});
it("continues authorized work independently of page polling until stopped", async () => {
  const input = options(),
    stop = new AbortController();
  mocks.plan.mockImplementation(async () => {
    if (mocks.plan.mock.calls.length === 2) stop.abort();
    return { state: "idle" };
  });
  try {
    const running = runParentWorkerService({
      ...input,
      watch: true,
      signal: stop.signal,
    });
    await running;
    expect(mocks.plan.mock.calls.length).toBeGreaterThan(1);
    expect(input.database.query).toHaveBeenCalledWith(
      "select parent_private.parent_record_worker_health($1,$2)",
      [true, true],
    );
    expect(input.database.query).toHaveBeenLastCalledWith(
      "select parent_private.parent_record_worker_health(false,false)",
    );
  } finally {
    stop.abort();
  }
}, 10000);
it.each(["missing model key", "unavailable broker"])("checks only exact continuations with a private port and %s", async missing => {
  const input = options(), protectedSnapSubmission = { execute: vi.fn(), reconcile: vi.fn() };
  if (missing === "unavailable broker") input.fetcher.mockRejectedValue(new Error("offline"));
  await runParentWorkerService({ ...input, apiKey: missing === "missing model key" ? undefined : input.apiKey, protectedSnapSubmission });
  expect(mocks.plan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ continuationOnly: true, protectedSnapSubmission }));
  if (missing === "missing model key") { expect(mocks.assistant).not.toHaveBeenCalled(); expect(input.fetcher).not.toHaveBeenCalled(); }
  expect(protectedSnapSubmission.execute).not.toHaveBeenCalled(); expect(protectedSnapSubmission.reconcile).not.toHaveBeenCalled();
});

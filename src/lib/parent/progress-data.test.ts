import { beforeEach, expect, it, vi } from "vitest";
import { fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSupportProgress, listSupportProgress } from "./progress-data";
const progress = {
  state: "service_offline",
  summary: "Background planning is unavailable.",
  updatedAt: "2026-10-26T16:00:00Z",
  nextRunAt: null,
  canContinueAfterClosing: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
it("loads server-owned progress without inventing a healthy service, and keeps provider errors private", async () => {
  mocks.rpc.mockResolvedValue({ data: progress, error: null });
  expect(await getSupportProgress(fixtureRequest().id)).toEqual(progress);
  expect(mocks.rpc).toHaveBeenCalledWith("parent_request_progress", {
    p_request_id: fixtureRequest().id,
  });
  mocks.rpc.mockResolvedValue({
    data: { [fixtureRequest().id]: progress },
    error: null,
  });
  expect(await listSupportProgress()).toEqual({
    [fixtureRequest().id]: progress,
  });
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "private-server-detail" },
  });
  await expect(getSupportProgress(fixtureRequest().id)).rejects.toThrow(
    "permission has changed",
  );
  await expect(listSupportProgress()).rejects.not.toThrow(
    "private-server-detail",
  );
  mocks.rpc.mockResolvedValue({
    data: { ...progress, state: "made_up" },
    error: null,
  });
  await expect(getSupportProgress(fixtureRequest().id)).rejects.toThrow();
});

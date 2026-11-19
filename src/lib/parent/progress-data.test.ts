import { beforeEach, expect, it, vi } from "vitest";
import { fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSupportProgress, listSupportProgress } from "./progress-data";
import { parentError } from "./http";
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
    "CaseLink could not load support progress. Please try again.",
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
it.each(["42501", "57014", "malformed"])("distinguishes progress-only %s failure from a parent input error or lost permission", async code => {
  mocks.rpc.mockResolvedValue(code === "malformed" ? { data: { ...progress, state: "private-server-detail" }, error: null }
    : { data: null, error: { code, message: "private-server-detail" } });
  const error = await getSupportProgress(fixtureRequest().id).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  const result = parentError(error);
  expect(result.status).toBe(code === "42501" ? 403 : 500);
  expect(await result.text()).not.toContain("private-server-detail");
});
it.each(["42501", "57014", "malformed"])("preserves the progress-list %s authorization or transient-failure distinction", async code => {
  mocks.rpc.mockResolvedValue(code === "malformed" ? { data: { private: "private-server-detail" }, error: null }
    : { data: null, error: { code, message: "private-server-detail" } });
  const error = await listSupportProgress().catch(error => error);
  const result = parentError(error);
  expect(result.status).toBe(code === "42501" ? 403 : 500);
  expect(await result.text()).not.toContain("private-server-detail");
});

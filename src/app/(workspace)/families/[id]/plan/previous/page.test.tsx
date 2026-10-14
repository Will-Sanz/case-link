/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PreviousPlanPage from "./page";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
const id = "20000000-0000-4000-8000-000000000002";
beforeEach(() => mocks.rpc.mockReset());
it("shows the exact saved prior work as read-only reference, including waiting and completed outcomes", async () => {
  mocks.rpc.mockResolvedValue({ data: { version: 2, steps: [{ id: "step", title: "Housing", description: "Prepare the agreed checklist", details: { expected_outcome: "Intake ready" }, action_items: [
    { id: "done", title: "Finish intake", status: "completed", target_date: "2026-10-01", outcome: "Intake completed" },
    { id: "wait", title: "Check decision", status: "blocked", target_date: "2026-10-01", follow_up_date: "2026-10-25", notes: "Awaiting a decision" },
  ] }] }, error: null });
  render(await PreviousPlanPage({ params: Promise.resolve({ id }) }));
  expect(screen.getByRole("heading", { name: "Previous reviewed plan · Version 2" })).toBeTruthy();
  expect(screen.getByText("Outcome: Intake completed")).toBeTruthy();
  expect(screen.getByText("waiting · Follow up: 2026-10-25")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to current draft" }).getAttribute("href")).toBe(`/families/${id}/plan`);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(mocks.rpc).toHaveBeenCalledWith("get_previous_reviewed_plan", { p_family_id: id });
});
it("fails closed for missing/denied history and database failure", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await expect(PreviousPlanPage({ params: Promise.resolve({ id }) })).rejects.toThrow("not found");
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "private diagnostic" } });
  await expect(PreviousPlanPage({ params: Promise.resolve({ id }) })).rejects.toThrow("Could not load");
});
it("rejects invalid family paths before making a data request", async () => {
  await expect(PreviousPlanPage({ params: Promise.resolve({ id: "invalid" }) })).rejects.toThrow("not found");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureProtectedSnapOperation, fixtureRequest, fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import { SnapDecisionSummary } from "./snap-decision-summary";
const resource = vi.hoisted(() => ({ data: null as unknown, error: null as Error | null, loading: false, paths: [] as string[] }));
vi.mock("./use-parent-resource", () => ({ useParentResource: (path: string) => { resource.paths.push(path); return resource; } }));
const now = new Date("2026-11-06T16:30:00Z");
const snapshot = fixtureSnapSnapshot(now), request = fixtureRequest({ version: snapshot.request_version });
const review = fixtureProtectedSnapOperation({ requestVersion: request.version });
review.packet.protectedSnapPacket.snapshotId = snapshot.id;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); resource.data = { snapshot }; resource.error = null; resource.loading = false; resource.paths = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("decision-focused exact application summary", () => {
  it("reads the immutable packet revision and shows only compact validated facts without identifiers or duplicate controls", () => {
    render(<SnapDecisionSummary request={request} review={review}/>);
    expect(resource.paths[0]).toContain(`revision=${snapshot.id}`);
    expect(screen.getByText(/1 person; 1 requesting SNAP/)).toBeTruthy();
    expect(screen.getByText(/2026-11: No income reported/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Private Canary|1990-01-01|1 Synthetic Street/);
    expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it.each(["different-revision", "different-request", "future-version", "stale", "error", "loading"])("withholds facts for %s evidence", kind => {
    const value = structuredClone(snapshot);
    if (kind === "different-revision") value.id = "44444444-4444-4444-8444-444444444444";
    if (kind === "different-request") value.request_id = "44444444-4444-4444-8444-444444444444";
    if (kind === "future-version") value.request_version = request.version + 1;
    if (kind === "stale") vi.setSystemTime(new Date("2027-01-01"));
    if (kind === "error") resource.error = new Error("PRIVATE-CANARY");
    if (kind === "loading") resource.loading = true;
    resource.data = { snapshot: value }; render(<SnapDecisionSummary request={request} review={review}/>);
    expect(screen.queryByText(/1 person; 1 requesting SNAP/)).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-CANARY");
  });
  it("drops the old facts immediately when the packet points to a replacement revision", () => {
    const page = render(<SnapDecisionSummary request={request} review={review}/>);
    expect(screen.getByText(/1 person; 1 requesting SNAP/)).toBeTruthy();
    const replaced = structuredClone(review); replaced.packet.protectedSnapPacket.snapshotId = "44444444-4444-4444-8444-444444444444";
    page.rerender(<SnapDecisionSummary request={request} review={replaced}/>);
    expect(screen.queryByText(/1 person; 1 requesting SNAP/)).toBeNull();
  });
  it("keeps contrary requirements visible and labels emulator authority explicitly", () => {
    render(<SnapDecisionSummary request={{ ...request, controlled_test: true, required_actions: [{ id: "issue", need: "snap_new", reason: "personal_step", title: "Complete the interview", explanation: "Required personal step" }] }} review={review}/>);
    expect(screen.getByText(/Complete the interview/)).toBeTruthy(); expect(screen.getByText(/only to the free fax emulator/)).toBeTruthy();
  });
});

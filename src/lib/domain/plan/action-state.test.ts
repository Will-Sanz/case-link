import { describe, expect, it } from "vitest";
import {
  actionUiStatus,
  actionUserNotes,
  encodeActionNotes,
  isActionNoLongerNeeded,
} from "@/lib/domain/plan/action-state";

describe("plan action state", () => {
  it("round-trips a no-longer-needed marker without exposing it to the case manager", () => {
    const notes = encodeActionNotes("Family chose a different service.", true);

    expect(notes).toContain("resolution=no_longer_needed");
    expect(actionUserNotes(notes)).toBe("Family chose a different service.");
    expect(isActionNoLongerNeeded({ status: "completed", notes })).toBe(true);
    expect(actionUiStatus({ status: "completed", notes })).toBe("no_longer_needed");
  });

  it("removes the marker when an action is reopened", () => {
    const marked = encodeActionNotes("Needs another review.", true);
    const reopened = encodeActionNotes(marked, false);

    expect(reopened).toBe("Needs another review.");
    expect(actionUiStatus({ status: "pending", notes: reopened })).toBe("pending");
  });

  it("presents the storage-only blocked state as waiting", () => {
    expect(actionUiStatus({ status: "blocked", notes: "Awaiting callback" })).toBe("waiting");
  });
});

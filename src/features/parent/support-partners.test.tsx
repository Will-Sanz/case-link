// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { SupportPartners } from "./support-partners";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows only the actual original directory partners relevant to the named request programs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        partners: [
          {
            legacyResourceId: "one",
            name: "Original PECO resource",
            officialUrl:
              "https://www.peco.com/my-account/customer-support/assistance-programs",
            programIds: ["peco-cap"],
            directoryUpdatedAt: "2026-10-14T12:00:00Z",
            sourceCheckedAt: "2026-10-26",
            relationship: "existing_partner",
            execution: "not_connected",
          },
          {
            legacyResourceId: "two",
            name: "Unrelated water resource",
            officialUrl: "https://cap.phila.gov/",
            programIds: ["pwd-tap"],
            directoryUpdatedAt: "2026-10-14T12:00:00Z",
            sourceCheckedAt: "2026-10-26",
            relationship: "existing_partner",
            execution: "not_connected",
          },
        ],
      }),
    }),
  );
  render(<SupportPartners request={fixtureRequest()} />);
  expect(
    await screen.findByRole("link", { name: "Original PECO resource" }),
  ).toBeTruthy();
  expect(screen.queryByText("Unrelated water resource")).toBeNull();
  expect(screen.getByText(/automated delivery not connected/)).toBeTruthy();
  expect(
    screen.getByText(/does not mean CaseLink has sent your information/),
  ).toBeTruthy();
});

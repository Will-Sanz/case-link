import { afterEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CaseManagerProfileClient } from "./case-manager-profile-client";
import type { AppUserRow } from "@/types/database";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/actions/auth", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/actions/profile", () => ({ updateCaseManagerProfile: vi.fn() }));

const originalTimezone = process.env.TZ;
afterEach(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });
const profile: AppUserRow = {
  id: "synthetic-profile", email: "staff@example.test", role: "case_manager", is_active: true,
  created_at: "2026-10-14T00:30:00Z", updated_at: "2026-10-14T00:30:00Z",
};

it.each(["UTC", "Pacific/Auckland"])("renders account dates in the school timezone when the runtime uses %s", timezone => {
  process.env.TZ = timezone;
  const html = renderToString(<CaseManagerProfileClient profile={profile} />);
  expect(html).toContain("October 13, 2026");
  expect(html).toContain("Oct 13, 2026, 8:30 PM");
});

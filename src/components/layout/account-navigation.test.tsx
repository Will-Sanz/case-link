/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/families",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/app/actions/auth", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/actions/profile", () => ({ updateCaseManagerProfile: vi.fn() }));

import { FamilyCaseChrome } from "@/components/layout/family-case-chrome";
import { CaseManagerProfileClient } from "@/features/profile/case-manager-profile-client";

describe("account navigation", () => {
  it("keeps Settings and Help at the bottom without a sidebar sign-out action", () => {
    navigation.pathname = "/families";
    render(<FamilyCaseChrome>Content</FamilyCaseChrome>);

    expect(within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link")).toHaveLength(1);
    expect(
      within(screen.getByRole("navigation", { name: "Account and help" }))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["Settings", "Help & product guide"]);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("marks only the current family destination as active", () => {
    const familyId = "11111111-1111-4111-8111-111111111111";
    navigation.pathname = `/families/${familyId}/profile`;
    render(<FamilyCaseChrome>Content</FamilyCaseChrome>);

    const workspace = within(screen.getByRole("navigation", { name: "Workspace" }));
    const familyWorkspace = within(screen.getByRole("navigation", { name: "Family workspace" }));
    expect(workspace.getByRole("link", { name: "Families" }).getAttribute("aria-current")).toBeNull();
    expect(familyWorkspace.getByRole("link", { name: "Family profile" }).getAttribute("aria-current")).toBe("page");
  });

  it("hides technical identifiers while keeping sign out on the profile", () => {
    render(
      <CaseManagerProfileClient
        profile={{
          id: "11111111-1111-4111-8111-111111111111",
          email: "case.manager@example.org",
          role: "case_manager",
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-02T12:00:00.000Z",
          display_name: "Case Manager",
        }}
      />,
    );

    expect(screen.queryByText("Technical account details")).toBeNull();
    expect(screen.queryByText(/User ID:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

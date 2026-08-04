/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  enrichFamiliesWithCurrentStep: vi.fn(),
  listFamilies: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/services/families", () => ({
  enrichFamiliesWithCurrentStep: mocks.enrichFamiliesWithCurrentStep,
  listFamilies: mocks.listFamilies,
}));

import FamiliesPage from "@/app/(workspace)/families/page";

describe("FamiliesPage", () => {
  it("opens a family on its profile landing page", async () => {
    const family = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test household",
      summary: "Housing support needed.",
      urgency: "high" as const,
      status: "active" as const,
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-02T12:00:00.000Z",
      created_by_id: "22222222-2222-4222-8222-222222222222",
      creator: null,
      current_step: null,
    };
    mocks.createSupabaseServerClient.mockResolvedValue({});
    mocks.listFamilies.mockResolvedValue({ items: [family], total: 1 });
    mocks.enrichFamiliesWithCurrentStep.mockResolvedValue([family]);

    render(await FamiliesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: /Test household/ }).getAttribute("href")).toBe(
      `/families/${family.id}/profile`,
    );
  });
});

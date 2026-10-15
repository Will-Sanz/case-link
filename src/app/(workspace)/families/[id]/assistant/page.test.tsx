import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FamilyAssistantPage from "./page";

const m = vi.hoisted(() => ({ db: {}, family: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => m.db }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: m.family }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/features/families/case-assistant-chat", () => ({ CaseAssistantChat: ({ familyName }: { familyName: string }) => <h1>{familyName}</h1> }));
const id = "20000000-0000-4000-8000-000000000002";
beforeEach(() => m.family.mockReset());

it("opens the existing assistant only for a family returned by the user-bound database", async () => {
  m.family.mockResolvedValue({ id, name: "Family 014" });
  const html = renderToStaticMarkup(await FamilyAssistantPage({ params: Promise.resolve({ id }) }));
  expect(m.family).toHaveBeenCalledWith(m.db, id);
  expect(html).toContain("Family 014");
  expect(html).toContain(`/families/${id}/plan`);
});

it("rejects invalid IDs before loading a family", async () => {
  await expect(FamilyAssistantPage({ params: Promise.resolve({ id: "invalid" }) })).rejects.toThrow("not-found");
  expect(m.family).not.toHaveBeenCalled();
});

it("does not render a missing or inaccessible family's assistant", async () => {
  m.family.mockResolvedValue(null);
  await expect(FamilyAssistantPage({ params: Promise.resolve({ id }) })).rejects.toThrow("not-found");
});

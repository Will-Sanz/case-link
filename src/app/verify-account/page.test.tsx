import { expect, it, vi } from "vitest";
import VerifyAccountPage from "./page";
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { is_active: true, role: "admin" } }) };
  return { auth: { getUser: async () => ({ data: { user: { id: "administrator" } } }) }, from: () => query };
} }));
vi.mock("@/features/auth/mfa-form", () => ({ MfaForm: () => null }));
it.each(["https://attacker.example", ["/profile", "//attacker.example"]])("does not navigate to an unsafe or duplicate next parameter", async (next) => {
  const page = await VerifyAccountPage({ searchParams: Promise.resolve({ next }) });
  expect(page.props.children.props.nextPath).toBe("/families");
  expect(page.props.children.props.required).toBe(true);
});

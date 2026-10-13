/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";

const m = vi.hoisted(() => ({ signIn: vi.fn(), reset: vi.fn(), update: vi.fn(), session: vi.fn(), router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, params: new URLSearchParams("mode=recovery") }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router, useSearchParams: () => m.params }));
vi.mock("@/components/legal/legal-document-modal", () => ({ LegalDocumentModal: () => null }));
vi.mock("@/lib/auth/public-site-url-client", () => ({ getBrowserPublicSiteOrigin: () => "https://school.example" }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { signInWithPassword: m.signIn, resetPasswordForEmail: m.reset, updateUser: m.update, getSession: m.session } }) }));
beforeEach(() => {
  m.params = new URLSearchParams("mode=recovery");
  m.session.mockResolvedValue({ data: { session: { user: { id: "staff" } } }, error: null });
});

describe("auth form recovery", () => {
  it("retains normalized email/password for retry after a thrown login failure", async () => {
    m.signIn.mockRejectedValueOnce(new Error("private provider detail")).mockResolvedValueOnce({ error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "STAFF@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Synthetic-test-password1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    expect(screen.queryByText("private provider detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(m.router.push).toHaveBeenCalledWith("/families"));
    expect(m.signIn).toHaveBeenLastCalledWith({ email: "staff@example.test", password: "Synthetic-test-password1!" });
  });
  it("guards duplicate submissions even before the pending state renders", async () => {
    let finish!: (value: unknown) => void;
    m.signIn.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<LoginForm />);
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(m.signIn).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ error: null }); });
  });
  it("recovers from a reset-email outage with the same generic account acknowledgement", async () => {
    m.reset.mockRejectedValueOnce(new Error("private provider detail")).mockResolvedValueOnce({ error: null });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Please try again");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("status")).textContent).toContain("If an account exists");
  });
  it("shows recovery instead of an indefinite spinner when checking the reset session throws", async () => {
    m.session.mockRejectedValue(new Error("cookies unavailable"));
    render(<ResetPasswordForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't verify");
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toBeTruthy();
  });
  it("allows retry after an unexpected password-update failure", async () => {
    m.update.mockRejectedValue(new Error("network unavailable"));
    render(<ResetPasswordForm />);
    const password = await screen.findByLabelText("New password");
    fireEvent.change(password, { target: { value: "Synthetic-test-password1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Synthetic-test-password1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Please try again");
    expect((screen.getByRole("button", { name: "Update password" }) as HTMLButtonElement).disabled).toBe(false);
    expect((password as HTMLInputElement).value).toBe("Synthetic-test-password1!");
  });
});

it("never displays untrusted callback error text, including in development", () => {
  m.params.set("error", "private provider token");
  render(<LoginForm />);
  expect(screen.getByRole("alert").textContent).toBe("Sign-in could not be completed. Try again or request a new link.");
});

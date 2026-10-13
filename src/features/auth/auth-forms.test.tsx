/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";

const m = vi.hoisted(() => ({ signIn: vi.fn(), reset: vi.fn(), update: vi.fn(), session: vi.fn(), signOut: vi.fn(), reauthenticate: vi.fn(), router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, params: new URLSearchParams("mode=recovery") }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router, useSearchParams: () => m.params }));
vi.mock("@/components/legal/legal-document-modal", () => ({ LegalDocumentModal: () => null }));
vi.mock("@/lib/auth/public-site-url-client", () => ({ getBrowserPublicSiteOrigin: () => "https://school.example" }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { signInWithPassword: m.signIn, resetPasswordForEmail: m.reset, updateUser: m.update, getSession: m.session, signOut: m.signOut, reauthenticate: m.reauthenticate } }) }));
beforeEach(() => {
  m.params = new URLSearchParams("mode=recovery");
  m.signOut.mockResolvedValue({ error: null });
  m.reauthenticate.mockResolvedValue({ error: null });
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

async function fillPassword() {
  const password = await screen.findByLabelText("New password");
  fireEvent.change(password, { target: { value: "Synthetic-test-password1!" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Synthetic-test-password1!" } });
}
it.each(["weak_password", "same_password"])("keeps policy error %s editable without demanding a new email", async (code) => {
  m.update.mockResolvedValue({ error: { code } });
  render(<ResetPasswordForm />);
  await fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("link", { name: "Request a new reset link" })).toBeNull();
  expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("Synthetic-test-password1!");
});
it("confirms an older session with a nonce, then signs out before the login destination", async () => {
  m.update.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } }).mockResolvedValueOnce({ error: null });
  render(<ResetPasswordForm />);
  await fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send verification code" }));
  await screen.findByText(/Check your account email/);
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/login?message=password-reset-success"));
  expect(m.update).toHaveBeenLastCalledWith({ password: "Synthetic-test-password1!", nonce: "123456" });
  expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
  expect(m.signOut.mock.invocationCallOrder[0]).toBeLessThan(m.router.replace.mock.invocationCallOrder[0]);
});
it("retries only sign-out when the password was already changed", async () => {
  m.update.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValueOnce({ error: {} }).mockResolvedValueOnce({ error: null });
  render(<ResetPasswordForm />);
  await fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  expect((await screen.findByRole("alert")).textContent).toContain("password was updated");
  expect(screen.queryByLabelText("New password")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Finish signing out" }));
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/login?message=password-reset-success"));
  expect(m.update).toHaveBeenCalledTimes(1);
  expect(m.signOut).toHaveBeenCalledTimes(2);
});
it("blocks mismatched passwords before contacting Auth", async () => {
  render(<ResetPasswordForm />);
  await fillPassword();
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "Different-password1!" } });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  expect(screen.getByRole("alert").textContent).toContain("do not match");
  expect(m.update).not.toHaveBeenCalled();
});

it("sends one password change when submitted twice while waiting", async () => {
  let finish!: (value: unknown) => void;
  m.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResetPasswordForm />);
  await fillPassword();
  const form = screen.getByRole("button", { name: "Update password" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(m.update).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ error: null }); });
  expect(m.signOut).toHaveBeenCalledTimes(1);
});

it("can cancel a recovery session without changing the password or looping back into setup", async () => {
  render(<ResetPasswordForm />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel and return to sign in" }));
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/login"));
  expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
  expect(m.update).not.toHaveBeenCalled();
});

/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MfaForm } from "./mfa-form";

const m = vi.hoisted(() => ({ list: vi.fn(), assurance: vi.fn(), enroll: vi.fn(), verify: vi.fn(), remove: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ rpc: m.rpc, auth: { signOut: m.signOut, mfa: { listFactors: m.list, getAuthenticatorAssuranceLevel: m.assurance, enroll: m.enroll, challengeAndVerify: m.verify, unenroll: m.remove } } }) }));
const factor = { id: "factor-one", factor_type: "totp", status: "verified", friendly_name: "CaseLink authenticator" };
beforeEach(() => {
  vi.clearAllMocks();
  m.list.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  m.assurance.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  m.enroll.mockResolvedValue({ data: { id: factor.id, totp: { qr_code: "data:image/svg+xml;utf-8,<svg></svg>", secret: "SYNTHETICSETUPKEY" } }, error: null });
  m.verify.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null });
  m.rpc.mockResolvedValue({ data: true, error: null });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it("enrolls only on request, then verifies once before opening the workspace", async () => {
  render(<StrictMode><MfaForm required manage={false} nextPath="/families" /></StrictMode>);
  const setup = await screen.findByRole("button", { name: "Set up an authenticator" });
  expect(m.enroll).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  fireEvent.click(setup);
  expect(await screen.findByAltText("Authenticator setup QR code")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
  const form = screen.getByRole("button", { name: "Verify code" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/families"));
  expect(m.enroll).toHaveBeenCalledOnce();
  expect(m.verify).toHaveBeenCalledOnce();
  expect(m.verify).toHaveBeenCalledWith({ factorId: factor.id, code: "123456" });
  expect(screen.queryByText("SYNTHETICSETUPKEY")).toBeNull();
});
it("challenges returning users and recovers from a wrong or expired code", async () => {
  m.list.mockResolvedValue({ data: { all: [factor], totp: [factor] } });
  m.verify.mockResolvedValueOnce({ error: { code: "mfa_verification_failed" } }).mockResolvedValueOnce({ error: null });
  render(<MfaForm required manage={false} nextPath="/reset-password?mode=recovery" />);
  fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: "000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  expect((await screen.findByRole("alert")).textContent).toContain("current code");
  expect(m.router.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/reset-password?mode=recovery"));
});
it("keeps the workspace closed when the database cannot confirm verification", async () => {
  m.list.mockResolvedValue({ data: { all: [factor], totp: [factor] } });
  m.rpc.mockResolvedValue({ data: false, error: null });
  render(<MfaForm required manage={false} nextPath="/families" />);
  fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("alert");
  expect(m.router.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Reload verification methods" })).toBeTruthy();
});
it("offers a recoverable load failure", async () => {
  m.list.mockRejectedValueOnce(new Error("private provider error"));
  render(<MfaForm required manage={false} nextPath="/families" />);
  expect((await screen.findByRole("alert")).textContent).not.toContain("private provider error");
  fireEvent.click(screen.getByRole("button", { name: "Reload verification methods" }));
  await screen.findByRole("button", { name: "Set up an authenticator" });
});
it("requires confirmation to remove a factor and retries only logout if removal succeeded", async () => {
  m.list.mockResolvedValue({ data: { all: [factor], totp: [factor] } });
  m.assurance.mockResolvedValue({ data: { currentLevel: "aal2" } });
  m.signOut.mockResolvedValueOnce({ error: {} }).mockResolvedValueOnce({ error: null });
  render(<MfaForm required manage nextPath="/profile" />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove authenticator" }));
  expect(m.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove and sign out" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish signing out" }));
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/login"));
  expect(m.remove).toHaveBeenCalledOnce();
  expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
});
it("recovers an unfinished setup without creating duplicate factors on mount", async () => {
  m.list.mockResolvedValue({ data: { all: [{ ...factor, status: "unverified" }], totp: [] } });
  render(<MfaForm required manage={false} nextPath="/families" />);
  await screen.findByRole("button", { name: "Discard unfinished setup" });
  expect(m.enroll).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Set up an authenticator" })).toBeNull();
});
it("ignores a verification result after leaving the screen", async () => {
  let finish!: (value: unknown) => void;
  m.list.mockResolvedValue({ data: { all: [factor], totp: [factor] } });
  m.verify.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<MfaForm required manage={false} nextPath="/families" />);
  fireEvent.change(await screen.findByLabelText("Authenticator code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  view.unmount();
  await act(async () => { finish({ error: null }); });
  expect(m.router.replace).not.toHaveBeenCalled();
});

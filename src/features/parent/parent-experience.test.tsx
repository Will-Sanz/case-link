// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentApiError, parentApi, safeReturnPath, displayDate } from "./api";
import { ParentSignIn } from "./sign-in";
import { buildMandate, initialIntake, ParentIntake } from "./intake";
import { SupportDocuments } from "./support-documents";
import { MySupport, requestStatus } from "./my-support";
import type { SupportRequest } from "@/lib/parent/domain";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const account = { ok: true, account: { email: "synthetic@example.test" } };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("parent API and navigation", () => {
  it("offers only existing passwords and original-site recovery when email-code enrollment is unavailable", () => {
    render(
      <ParentSignIn
        existingAccountRecovery
        emailCodeAvailable={false}
        recoveryHref="https://www.old.example.test/forgot-password"
      />,
    );
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use an email code instead" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Forgot your password?" })
        .getAttribute("href"),
    ).toBe("https://www.old.example.test/forgot-password");
    expect(screen.getByText(/then return here to sign in/)).toBeTruthy();
    expect(screen.queryByText(/New here or need a code/)).toBeNull();
  });
  it("allows only supported local return paths", () => {
    expect(safeReturnPath("https://attacker.test")).toBe("/my-support");
    expect(safeReturnPath("//attacker.test")).toBe("/my-support");
    expect(safeReturnPath("/support/privacy?token=secret")).toBe("/my-support");
    expect(safeReturnPath("/get-support?need=food")).toBe(
      "/get-support?need=food",
    );
  });
  it("uses a stable service timezone without moving a date-only shutoff notice", () => {
    expect(displayDate("2026-10-25")).toBe("Oct 25, 2026");
    expect(displayDate("unreadable")).toBe("Date unavailable");
  });
  it("preserves authentication and configuration failure status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: false, error: "Sign in again." }, 401),
        ),
    );
    await expect(parentApi("/requests")).rejects.toEqual(
      new ParentApiError("Sign in again.", 401),
    );
  });
});

describe("email sign-in", () => {
  it("keeps the email form usable when code delivery is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            error: "Sign-in is temporarily unavailable. Please try again.",
          },
          503,
        ),
      ),
    );
    render(<ParentSignIn />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use an email code instead" }),
    );
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "new-parent@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Email code")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "See direct support options" })
        .getAttribute("href"),
    ).toBe("/support/help");
    expect(
      (screen.getByLabelText("Your email address") as HTMLInputElement).value,
    ).toBe("new-parent@example.test");
  });
  it("links shared-account password recovery to the existing flow without treating an email code as a password", () => {
    const { rerender } = render(<ParentSignIn existingAccountRecovery />);
    expect(
      screen
        .getByRole("link", { name: "Forgot your password?" })
        .getAttribute("href"),
    ).toBe("/forgot-password");
    expect(
      screen.getByText(/Reset your existing CaseLink password/),
    ).toBeTruthy();
    rerender(<ParentSignIn />);
    expect(
      screen.queryByRole("link", { name: "Forgot your password?" }),
    ).toBeNull();
  });
  it("shows a safe recovery result without accepting arbitrary provider messages", () => {
    const { rerender } = render(
      <ParentSignIn authNotice="password-reset-success" />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Sign in with your new password",
    );
    rerender(<ParentSignIn authNotice="auth-link-error" key="error" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Sign-in could not be completed",
    );
  });
  it("uses the existing account password without creating an account or support mandate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentSignIn returnTo="https://attacker.test" />);
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "existing@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/my-support"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "sign_in",
      email: "existing@example.test",
      password: "synthetic-password",
    });
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("clears the password when choosing email recovery and never sends it with a code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentSignIn />);
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "existing@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use an email code instead" }),
    );
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    await screen.findByLabelText("Email code");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "send_code",
      email: "existing@example.test",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use my CaseLink password" }),
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("verifies a code and uses a safe return path without authorizing support", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentSignIn returnTo="/get-support?need=food" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use an email code instead" }),
    );
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "synthetic@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    const codeInput = await screen.findByLabelText("Email code");
    expect(document.activeElement).toBe(codeInput);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "send_code",
      email: "synthetic@example.test",
    });
    fireEvent.change(screen.getByLabelText("Email code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/get-support?need=food"),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: "verify_code",
      email: "synthetic@example.test",
      token: "123456",
    });
    expect(
      fetchMock.mock.calls.every((call) => call[0] === "/api/parent/auth"),
    ).toBe(true);
  });
  it("keeps the email/code and provides recovery after a verification error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(
          jsonResponse(
            { ok: false, error: "That code expired. Request a new one." },
            400,
          ),
        ),
    );
    render(<ParentSignIn />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use an email code instead" }),
    );
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "synthetic@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByLabelText("Email code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Email code") as HTMLInputElement).value,
    ).toBe("123456");
    expect(
      screen.getByRole("button", { name: "Send a new code" }),
    ).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("informed support start", () => {
  it("keeps preparation-only scope, named recipients, consent and concrete limits", () => {
    const expiresAt = "2026-11-24T12:00:00.000Z";
    const mandate = buildMandate(
      { ...initialIntake, needs: ["electricity"] },
      ["peco-cap"],
      "prepare_only",
      "ask_me",
      expiresAt,
    );
    expect(mandate.allowedActions).toEqual(["research", "prepare"]);
    expect(mandate.recipientIds).toEqual(["peco-cap"]);
    expect(mandate.allowedData).toEqual([
      "household",
      "documents",
      "income",
      "utility",
    ]);
    expect(mandate.maxRecipients).toBe(1);
    expect(mandate.maxAttempts).toBe(12);
    expect(mandate.expiresAt).toBe("2026-11-24T12:00:00.000Z");
  });
  it("preserves answers and exact operation identity across a failed start and retry", async () => {
    const attempts: RequestInit[] = [];
    const windows = vi.fn(() =>
      jsonResponse({
        ok: true,
        authorization: { expiresAt: "2026-11-24T12:00:00.000Z" },
      }),
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2028-01-01T00:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/account")) return jsonResponse(account);
        if (url.endsWith("/capabilities"))
          return jsonResponse({ ok: true, capabilities: [] });
        if (url.endsWith("/authorization-window")) return windows();
        attempts.push(options);
        if (attempts.length === 1)
          throw new Error("The connection was interrupted. Try again.");
        return jsonResponse({
          ok: true,
          request: { id: "11111111-1111-4111-8111-111111111111" },
        });
      }),
    );
    render(<ParentIntake initialNeed="food" />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Food for now/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("checkbox", {
        name: /Philadelphia food and meal finder/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("About these programs & direct access"),
    ).toBeTruthy();
    expect(screen.getByText(/Applications are not connected yet/)).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText(/I authorize research and preparation only/),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start getting support" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Start getting support" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/support/11111111-1111-4111-8111-111111111111",
      ),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0].headers).toEqual(attempts[1].headers);
    expect(attempts[0].body).toBe(attempts[1].body);
    expect(JSON.parse(String(attempts[1].body)).intake.zip).toBe("19104");
    expect(JSON.parse(String(attempts[1].body)).mandate.expiresAt).toBe(
      "2026-11-24T12:00:00.000Z",
    );
    expect(windows).toHaveBeenCalledOnce();
  });
  it("does not collect intake when secure parent processing is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            ok: false,
            error: "Online support is not accepting information yet.",
          },
          503,
        ),
      ),
    );
    render(<ParentIntake />);
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Household ZIP code")).toBeNull();
    expect(
      screen.getByRole("link", { name: "See direct support options" }),
    ).toBeTruthy();
  });
});

describe("documents and recorded progress", () => {
  it("requires understandable consent before exposing camera or file capture", () => {
    render(
      <SupportDocuments
        requestId="test"
        documents={[]}
        inactive={false}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Add a document or take a photo"));
    expect(screen.queryByLabelText("Choose a bill or notice")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByLabelText("Choose a bill or notice")).toBeTruthy();
    expect(screen.getByLabelText("Take a photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByLabelText("Take a photo")).toBeNull();
  });
  it("rejects oversized files before a network upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SupportDocuments
        requestId="test"
        documents={[]}
        inactive={false}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    const file = new File(["test"], "bill.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 10485761 });
    fireEvent.change(screen.getByLabelText("Choose a bill or notice"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload privately" }));
    await screen.findByRole("alert");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps cancelled and unresolved states distinct from success", () => {
    const request = {
      status: "active",
      plan: null,
      required_actions: [{ resolved: false }],
    } as SupportRequest;
    expect(requestStatus(request)).toBe("A step needs you");
    expect(requestStatus({ ...request, status: "cancelled" })).toBe(
      "Cancelled",
    );
  });
  it("offers sign-in recovery without showing household information to an expired session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: false, error: "Sign in again." }, 401),
        ),
    );
    render(<MySupport />);
    expect(
      await screen.findByRole("link", { name: "Sign in to continue" }),
    ).toBeTruthy();
    expect(screen.queryByText("Support in progress")).toBeNull();
  });
});

describe("request switching and service ownership", () => {
  it("does not present an operator-owned task as a parent requirement", () => {
    const request = {
      status: "active",
      plan: null,
      required_actions: [{ resolved: false, resolver: "operator" }],
    } as SupportRequest;
    expect(requestStatus(request)).toBe("Waiting on a service step");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentSignIn } from "./sign-in";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const response = (ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => ({ ok, error: "Please try again." }) });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("pending sign-in fields", () => {
  it("keeps the code destination fixed until delivery responds, then unlocks a rejected code for correction", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentSignIn />);
    fireEvent.click(screen.getByRole("button", { name: "Use an email code instead" }));
    const email = screen.getByLabelText("Your email address") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "original@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(email.disabled).toBe(true);
    fireEvent.submit(email.form!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(response());
    const code = await screen.findByLabelText("Email code") as HTMLInputElement;
    expect(code.disabled).toBe(false);
    expect(screen.getByText("original@example.test")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "send_code", email: "original@example.test" });
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(code.disabled).toBe(true);
    fireEvent.submit(code.form!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(response(false));
    await screen.findByRole("alert");
    expect(code.disabled).toBe(false);
    expect(code.value).toBe("123456");
    fireEvent.change(code, { target: { value: "654321" } });
    expect(code.value).toBe("654321");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("locks the submitted account and password during sign-in and restores editing after failure", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentSignIn emailCodeAvailable={false} />);
    const email = screen.getByLabelText("Your email address") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "original@example.test" } });
    fireEvent.change(password, { target: { value: "synthetic-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(email.disabled).toBe(true);
    expect(password.disabled).toBe(true);
    fireEvent.submit(password.form!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(response(false));
    await waitFor(() => expect(password.disabled).toBe(false));
    expect(email.disabled).toBe(false);
    expect(password.value).toBe("synthetic-password");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

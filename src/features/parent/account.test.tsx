// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentAccount } from "./account";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const account = {
  ok: true,
  account: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "synthetic@example.test",
    preferences: {
      contactPreference: "in_app",
      language: "en",
      quietHoursStart: 21,
      quietHoursEnd: 8,
    },
  },
};
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parent account controls", () => {
  it("saves chosen notification and quiet-hour preferences through the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(account));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentAccount />);
    fireEvent.change(await screen.findByLabelText("Support updates"), {
      target: { value: "email" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByRole("status");
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(post![1].body)).toEqual({
      action: "preferences",
      preferences: {
        contactPreference: "email",
        language: "en",
        quietHoursStart: 20,
        quietHoursEnd: 8,
      },
    });
  });
  it("requires exact deletion confirmation and preserves a sign-out warning after deletion succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(account))
      .mockResolvedValueOnce(ok({ ok: true }))
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ParentAccount />);
    fireEvent.click(
      await screen.findByText(
        "Delete my parent-support data & stop future work",
      ),
    );
    const button = screen.getByRole("button", {
      name: "Delete parent-support data & stop work",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText(
        /keeps your existing CaseLink sign-in and school records/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", {
        name: "Your deletion request is recorded",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Your existing CaseLink sign-in and school records are kept separate/,
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "couldn’t confirm sign-out",
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: "delete",
      confirmation: "DELETE",
      expectedOwnerId: "11111111-1111-4111-8111-111111111111",
    });
  });
});

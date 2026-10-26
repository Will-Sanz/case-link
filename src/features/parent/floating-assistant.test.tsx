// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import type { ParentAssistantConversation } from "@/lib/parent/assistant-contract";
import { FloatingAssistant } from "./floating-assistant";

let pathname = "/my-support";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
const first = fixtureRequest({
  intake: { ...fixtureRequest().intake, needs: ["snap_new"] },
});
const second = fixtureRequest({
  id: "a430cc02-d8d4-46cc-9900-5b397758fb16",
  intake: { ...fixtureRequest().intake, needs: ["water"] },
});
const conversation: ParentAssistantConversation = {
  messages: [],
  available: true,
  unavailableReason: null,
  historyLimited: false,
};
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
let mobile = false;
beforeEach(() => {
  pathname = "/my-support";
  mobile = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: mobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  for (const name of ["show", "showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        if (name === "close") this.removeAttribute("open");
        else this.setAttribute("open", "");
      }),
    });
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Ask CaseLink for assistance" }),
  );
function stubRequests(requests = [first]) {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/assistant")) return json(conversation);
    const request = requests.find((item) => url.endsWith(`/${item.id}`));
    return json(request ? { request } : { requests });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("floating family assistant", () => {
  it("opens only on request and retains a draft and consent after minimizing; Escape returns focus", async () => {
    const fetch = stubRequests();
    render(<FloatingAssistant signedIn />);
    expect(fetch).not.toHaveBeenCalled();
    open();
    const dialog = screen.getByRole("dialog", { name: "Ask CaseLink" });
    expect(HTMLDialogElement.prototype.show).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Minimize chat" }),
    );
    const input = await screen.findByLabelText(
      "Your question about this request",
    );
    fireEvent.change(input, {
      target: { value: "What happens after my interview?" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Ask CaseLink for assistance" }),
    );
    open();
    expect(
      (
        screen.getByLabelText(
          "Your question about this request",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("What happens after my interview?");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it("uses a native modal sheet on a phone and supports its cancel event", async () => {
    mobile = true;
    stubRequests();
    render(<FloatingAssistant signedIn />);
    open();
    const dialog = screen.getByRole("dialog", { name: "Ask CaseLink" });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("wraps phone Tab navigation at the dialog boundaries without trapping desktop navigation", async () => {
    mobile = true;
    stubRequests();
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 100, 44),
    ] as unknown as DOMRectList);
    render(<FloatingAssistant signedIn />);
    open();
    await screen.findByLabelText("Your question about this request");
    const dialog = screen.getByRole("dialog", { name: "Ask CaseLink" });
    const close = screen.getByRole("button", { name: "Minimize chat" });
    const consent = screen.getByRole("checkbox");
    close.focus();
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    expect(document.activeElement).toBe(consent);
    expect(fireEvent.keyDown(consent, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(close);
    mobile = false;
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(true);
    expect(dialog.hasAttribute("open")).toBe(true);
  });
  it("uses only the current detail request, clears its draft on context change, and does not mix requests", async () => {
    pathname = `/support/${first.id}`;
    const fetch = stubRequests([first, second]);
    const { rerender } = render(<FloatingAssistant signedIn />);
    open();
    const input = await screen.findByLabelText(
      "Your question about this request",
    );
    expect(screen.getByText("Your SNAP request")).toBeTruthy();
    fireEvent.change(input, {
      target: { value: "Draft for the SNAP request" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    pathname = `/support/${second.id}`;
    rerender(<FloatingAssistant signedIn />);
    await screen.findByText("Water bill request");
    const otherInput = await screen.findByLabelText(
      "Your question about this request",
    );
    expect((otherInput as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByText("Your SNAP request")).toBeNull();
    expect(
      fetch.mock.calls.some(
        ([url]) => url === `/api/parent/requests/${second.id}/assistant`,
      ),
    ).toBe(true);
    expect(
      fetch.mock.calls.some(([url]) => url === "/api/parent/requests"),
    ).toBe(false);
  });
  it("ignores a late response from a request after the parent changes context", async () => {
    pathname = `/support/${first.id}`;
    let finishFirst: (value: ReturnType<typeof json>) => void = () => {};
    const delayed = new Promise<ReturnType<typeof json>>((resolve) => {
      finishFirst = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `/api/parent/requests/${first.id}`) return delayed;
        return json(
          url.endsWith("/assistant") ? conversation : { request: second },
        );
      }),
    );
    const { rerender } = render(<FloatingAssistant signedIn />);
    open();
    await screen.findByText("Loading this request…");
    pathname = `/support/${second.id}`;
    rerender(<FloatingAssistant signedIn />);
    await screen.findByText("Water bill request");
    finishFirst(json({ request: first }));
    await waitFor(() =>
      expect(screen.queryByText("Your SNAP request")).toBeNull(),
    );
    expect(
      screen.getByRole("link", { name: "View progress" }).getAttribute("href"),
    ).toBe(`/support/${second.id}`);
  });
  it("requires selection when multiple saved requests exist, and uses a sole request automatically", async () => {
    const fetch = stubRequests([first, second]);
    render(<FloatingAssistant signedIn />);
    open();
    const picker = await screen.findByLabelText(
      "Which request can we help with?",
    );
    expect(
      screen.queryByLabelText("Your question about this request"),
    ).toBeNull();
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/assistant"))).toBe(
      false,
    );
    fireEvent.change(picker, { target: { value: second.id } });
    await screen.findByLabelText("Your question about this request");
    expect(
      screen.getByRole("link", { name: "View progress" }).getAttribute("href"),
    ).toBe(`/support/${second.id}`);
    fireEvent.change(picker, { target: { value: first.id } });
    await screen.findByText("Your SNAP request");
    expect(
      screen.getByRole("link", { name: "View progress" }).getAttribute("href"),
    ).toBe(`/support/${first.id}`);
  });
  it("shows only a validated owned SNAP website record and refreshes it without starting jobs", async () => {
    pathname = `/support/${first.id}`;
    let summary =
      "COMPASS requires provider verification before household entry.";
    let available = true;
    const website = () => ({
      ok: true,
      available,
      reason: null,
      session: available
        ? {
            id: "a430cc02-d8d4-46cc-9900-5b397758fb16",
            programId: "snap-pa",
            status: "blocked",
            currentUrl: "https://www.compass.dhs.pa.gov/intake/#/getstarted",
            title: "COMPASS",
            summary,
            updatedAt: "2026-10-26T16:00:00Z",
            canControl: false,
            frameUrl: null,
          }
        : null,
    });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.body).toBeUndefined();
      expect(init?.method).toBeUndefined();
      return json(
        url.endsWith("/browser")
          ? website()
          : url.endsWith("/assistant")
            ? conversation
            : { request: first },
      );
    });
    vi.stubGlobal("fetch", fetch);
    render(<FloatingAssistant signedIn />);
    open();
    await screen.findByText(summary);
    expect(screen.getByText("Website session blocked")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "See application progress and website" })
        .getAttribute("href"),
    ).toBe(`/support/${first.id}#application-overview`);
    expect(
      screen.getByText(/This website record is separate from chat/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: /official application page/ }),
    ).toBeNull();
    summary =
      "The latest website record is still blocked by provider verification.";
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh assistant conversation" }),
    );
    await screen.findByText(summary);
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    const closedReads = fetch.mock.calls.filter(([url]) =>
      url.endsWith("/browser"),
    ).length;
    available = false;
    open();
    await screen.findByText(
      "An active website connection cannot be confirmed.",
    );
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/browser")).length,
    ).toBe(closedReads + 1);
    expect(
      screen.getByLabelText("Your question about this request"),
    ).toBeTruthy();
  });
  it("does not leak a late website record into a different request or fetch website data for utility work", async () => {
    pathname = `/support/${first.id}`;
    let finishWebsite: (value: ReturnType<typeof json>) => void = () => {};
    const pendingWebsite = new Promise<ReturnType<typeof json>>((resolve) => {
      finishWebsite = resolve;
    });
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/browser")) return pendingWebsite;
      return json(
        url.endsWith("/assistant")
          ? conversation
          : { request: url.includes(second.id) ? second : first },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<FloatingAssistant signedIn />);
    open();
    await screen.findByRole("complementary", {
      name: "Application website status",
    });
    pathname = `/support/${second.id}`;
    rerender(<FloatingAssistant signedIn />);
    await screen.findByText("Water bill request");
    finishWebsite(
      json({
        ok: true,
        available: true,
        reason: null,
        session: { summary: "A different request’s private website status." },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", {
          name: "Application website status",
        }),
      ).toBeNull(),
    );
    expect(
      screen.queryByText("A different request’s private website status."),
    ).toBeNull();
    expect(
      fetch.mock.calls.some(
        ([url]) => url === `/api/parent/requests/${second.id}/browser`,
      ),
    ).toBe(false);
  });
  it("never claims access to unsaved intake or anonymous family context", async () => {
    pathname = "/get-support";
    const fetch = stubRequests();
    const { rerender } = render(<FloatingAssistant signedIn />);
    open();
    expect(
      await screen.findByText(/have not been saved as a support request yet/),
    ).toBeTruthy();
    expect(
      screen.getByText("CaseLink help · No saved request selected"),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /Start SNAP on Pennsylvania/ })
        .getAttribute("href"),
    ).toMatch(/^https:\/\/www.compass.dhs.pa.gov\/intake/);
    pathname = "/";
    rerender(<FloatingAssistant signedIn={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows a sign-in recovery instead of cached conversation after authorization is denied", async () => {
    pathname = `/support/${first.id}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: "Sign in again" }, 401)),
    );
    render(<FloatingAssistant signedIn={false} />);
    open();
    await screen.findByRole("link", { name: "Sign in to continue" });
    expect(
      screen.getByRole("link", { name: /Start SNAP on Pennsylvania/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("cancels only the queued question in the chosen request", async () => {
    pathname = `/support/${first.id}`;
    const fetch = vi.fn(async (url: string) =>
      json(
        url.endsWith("/assistant")
          ? {
              ...conversation,
              messages: [
                {
                  id: "queued",
                  question: "What happens next?",
                  status: "queued",
                  answer: null,
                  error: null,
                  created_at: first.created_at,
                  updated_at: first.updated_at,
                },
              ],
            }
          : { request: first },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    render(<FloatingAssistant signedIn />);
    open();
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel question" }),
    );
    await waitFor(() => {
      const deletion = fetch.mock.calls.find(
        (call) =>
          (call as unknown as [string, RequestInit])[1]?.method === "DELETE",
      ) as unknown as [string, RequestInit] | undefined;
      expect(deletion?.[0]).toBe(`/api/parent/requests/${first.id}/assistant`);
      expect(JSON.parse(String(deletion?.[1].body))).toEqual({
        messageId: "queued",
      });
    });
    expect(
      within(screen.getByRole("dialog")).getByText("What happens next?"),
    ).toBeTruthy();
  });
});

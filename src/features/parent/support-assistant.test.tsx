// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParentAssistantConversation } from "@/lib/parent/assistant-contract";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { SupportAssistant } from "./support-assistant";

const conversation = (
  overrides: Partial<ParentAssistantConversation> = {},
): ParentAssistantConversation => ({
  messages: [],
  available: true,
  unavailableReason: null,
  historyLimited: false,
  ...overrides,
});
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("request-connected assistant", () => {
  it("follows new replies inside the conversation while preserving a parent reading earlier history", async () => {
    const message = {
      id: "first",
      question: "What next?",
      status: "answered" as const,
      error: null,
      created_at: "2026-10-26T16:00:00Z",
      updated_at: "2026-10-26T16:00:00Z",
      answer: { intro: "Recorded answer one.", paragraphs: [], actionIds: [] },
    };
    let messages: ParentAssistantConversation["messages"] = [message];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(conversation({ messages }))),
    );
    render(<SupportAssistant request={fixtureRequest()} />);
    const list = await screen.findByRole("list", {
      name: "Conversation about this request",
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    list.scrollTop = 800;
    fireEvent.scroll(list);
    messages = [
      message,
      {
        ...message,
        id: "second",
        question: "Was anything sent?",
        status: "queued",
        answer: null,
      },
    ];
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1600,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh assistant conversation" }),
    );
    await screen.findByText("Was anything sent?");
    await waitFor(() => expect(list.scrollTop).toBe(1400));
    list.scrollTop = 100;
    fireEvent.scroll(list);
    messages = [
      message,
      {
        ...message,
        id: "second",
        question: "Was anything sent?",
        updated_at: "2026-10-26T16:01:00Z",
        answer: {
          intro: "Recorded answer two.",
          paragraphs: [],
          actionIds: [],
        },
      },
    ];
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh assistant conversation" }),
    );
    await screen.findByText("Recorded answer two.");
    expect(list.scrollTop).toBe(100);
  });
  it("requires consent and blocks sensitive identifiers before a request leaves the page", async () => {
    const fetch = vi.fn().mockResolvedValue(json(conversation()));
    vi.stubGlobal("fetch", fetch);
    render(<SupportAssistant request={fixtureRequest()} />);
    const question = await screen.findByLabelText(
      "Your question about this request",
    );
    fireEvent.change(question, { target: { value: "My SSN is 123-45-6789" } });
    const send = screen.getByRole("button", {
      name: "Ask CaseLink",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Remove personal identifiers",
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).not.toContain("123-45-6789");
  });
  it("preserves a question and exact idempotency key after a lost response, then clears it after server acceptance", async () => {
    const posts: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return json(conversation());
      posts.push(init);
      if (posts.length === 1) throw new Error("Disconnected");
      return json({ ok: true, id: "accepted" });
    });
    vi.stubGlobal("fetch", fetch);
    render(<SupportAssistant request={fixtureRequest()} />);
    const question = await screen.findByLabelText(
      "Your question about this request",
    );
    fireEvent.change(question, {
      target: { value: "What do I need to do next?" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ask CaseLink" }));
    await screen.findByRole("alert");
    expect((question as HTMLTextAreaElement).value).toBe(
      "What do I need to do next?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask CaseLink" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[0].body).toBe(posts[1].body);
    expect(JSON.parse(String(posts[1].body))).toMatchObject({
      question: "What do I need to do next?",
      consented: true,
    });
    await screen.findByText(
      "Your question is saved. Its answer will appear here.",
    );
    expect((question as HTMLTextAreaElement).value).toBe("");
  });
  it("shows worker unavailability without pretending a queued question is being answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          conversation({
            available: false,
            unavailableReason: "No live assistant connection.",
            messages: [
              {
                id: "q",
                question: "Was anything sent?",
                status: "queued",
                answer: null,
                error: null,
                created_at: "2026-10-26T16:00:00Z",
                updated_at: "2026-10-26T16:00:00Z",
              },
            ],
          }),
        ),
      ),
    );
    render(<SupportAssistant request={fixtureRequest()} />);
    expect(
      await screen.findByText("No live assistant connection."),
    ).toBeTruthy();
    expect(
      screen.getByText(/active assistant connection cannot be confirmed/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Ask CaseLink",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText(/Reading the saved information/)).toBeNull();
  });
  it("allows withdrawing a pending question without cancelling the support request", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json(
        conversation({
          messages: [
            {
              id: "pending-question",
              question: "What next?",
              status: "queued",
              answer: null,
              error: null,
              created_at: "2026-10-26T16:00:00Z",
              updated_at: "2026-10-26T16:00:00Z",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    render(<SupportAssistant request={fixtureRequest()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel question" }),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some((call) => call[1]?.method === "DELETE"),
      ).toBe(true),
    );
    const cancel = fetch.mock.calls.find(
      (call) => call[1]?.method === "DELETE",
    )!;
    expect(cancel[0]).toBe(
      `/api/parent/requests/${fixtureRequest().id}/assistant`,
    );
    expect(JSON.parse(cancel[1].body)).toEqual({
      messageId: "pending-question",
    });
    expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
      false,
    );
  });
  it("renders attributed real answers as text, filters unsafe source links and links only unresolved parent steps", async () => {
    const request = fixtureRequest({
      required_actions: [
        {
          id: "authority-electricity",
          need: "electricity",
          reason: "missing_fact",
          resolver: "parent",
          title: "Confirm your account authority",
          explanation: "Needed for this account.",
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          conversation({
            historyLimited: true,
            messages: [
              {
                id: "q",
                question: "What next?",
                status: "answered",
                error: null,
                created_at: "2026-10-26T16:00:00Z",
                updated_at: "2026-10-26T16:01:00Z",
                answer: {
                  intro: "Your request has not been submitted.",
                  paragraphs: [
                    {
                      text: "<script>unsafe()</script>",
                      sourceLabel: "Recorded request",
                      sourceUrl: "javascript:alert(1)",
                      recordedAt: "2026-10-26T16:00:00Z",
                    },
                    {
                      text: "A direct official route remains available.",
                      sourceLabel: "City food finder",
                      sourceUrl: "https://www.phila.gov/food/",
                    },
                  ],
                  actionIds: ["authority-electricity", "invented-step"],
                },
              },
            ],
          }),
        ),
      ),
    );
    const { rerender } = render(<SupportAssistant request={request} />);
    expect(
      await screen.findByText("Your request has not been submitted."),
    ).toBeTruthy();
    expect(screen.getByText("<script>unsafe()</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link", { name: "Recorded request" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "City food finder" })
        .getAttribute("href"),
    ).toBe("https://www.phila.gov/food/");
    expect(
      screen
        .getByRole("link", { name: /Go to your step/ })
        .getAttribute("href"),
    ).toBe("#step-authority-electricity");
    expect(screen.queryByText("invented-step")).toBeNull();
    expect(screen.getByText(/Showing your latest 40 questions/)).toBeTruthy();
    rerender(
      <SupportAssistant request={{ ...request, status: "cancelled" }} />,
    );
    expect(screen.queryByRole("link", { name: /Go to your step/ })).toBeNull();
  });
});

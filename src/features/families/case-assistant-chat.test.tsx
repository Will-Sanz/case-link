/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import { CaseAssistantChat } from "./case-assistant-chat";

vi.mock("@/app/actions/case-assistant", () => ({ askCaseAssistantAction: vi.fn() }));
const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";

beforeEach(() => {
  vi.mocked(askCaseAssistantAction).mockReset();
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe("case assistant conversation", () => {
  it.each(["returned", "thrown"])("restores a %s failed question for keyboard retry", async (failure) => {
    if (failure === "thrown") vi.mocked(askCaseAssistantAction).mockRejectedValueOnce(new Error("private failure"));
    else vi.mocked(askCaseAssistantAction).mockResolvedValueOnce({ ok: false, error: "Please retry." });
    render(<CaseAssistantChat familyId={familyId} familyName="Family 014" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Help sequence the intake." } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Help sequence the intake."));
    expect(screen.queryByText("private failure")).toBeNull();
    vi.mocked(askCaseAssistantAction).mockResolvedValueOnce({ ok: true, answer: "Begin with the intake." });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Begin with the intake.");
    expect(vi.mocked(askCaseAssistantAction).mock.calls[1][3]).toEqual([]);
  });

  it("ignores a late reply after clearing and lets a new request complete", async () => {
    let finish!: (value: { ok: true; answer: string }) => void;
    vi.mocked(askCaseAssistantAction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<CaseAssistantChat familyId={familyId} familyName="Family 014" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(askCaseAssistantAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    vi.mocked(askCaseAssistantAction).mockResolvedValueOnce({ ok: true, answer: "New answer" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("New answer");
    await act(async () => finish({ ok: true, answer: "Old answer" }));
    expect(screen.queryByText("Old answer")).toBeNull();
    expect(vi.mocked(askCaseAssistantAction).mock.calls[1][3]).toEqual([]);
  });

  it("continues past twenty exchanges with a bounded complete history", async () => {
    render(<CaseAssistantChat familyId={familyId} familyName="Family 014" />);
    for (let i = 0; i < 23; i++) {
      vi.mocked(askCaseAssistantAction).mockResolvedValueOnce({ ok: true, answer: `Reply ${i}` });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: `Question ${i}` } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText(`Reply ${i}`);
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    }
    const history = vi.mocked(askCaseAssistantAction).mock.calls.at(-1)?.[3];
    expect(history).toHaveLength(40);
    expect(history?.[0]).toEqual({ role: "user", content: "Question 2" });
    expect(history?.at(-1)).toEqual({ role: "assistant", content: "Reply 21" });
    expect(screen.getByRole("textbox").getAttribute("maxlength")).toBe("4000");
  });

  it("does not carry a pending response into another family's workspace", async () => {
    let finish!: (value: { ok: true; answer: string }) => void;
    vi.mocked(askCaseAssistantAction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<CaseAssistantChat key={familyId} familyId={familyId} familyName="Family 014" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old family question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    rerender(<CaseAssistantChat key="family-b" familyId="family-b" familyName="Family 015" />);
    await act(async () => finish({ ok: true, answer: "Old family answer" }));
    expect(screen.queryByText("Old family answer")).toBeNull();
    expect(screen.queryByText("Old family question")).toBeNull();
  });
});

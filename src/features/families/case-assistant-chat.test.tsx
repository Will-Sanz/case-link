/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import { CaseAssistantChat } from "./case-assistant-chat";

vi.mock("@/app/actions/case-assistant", () => ({ askCaseAssistantAction: vi.fn() }));
const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";

beforeEach(() => {
  vi.mocked(askCaseAssistantAction).mockReset();
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe("case assistant conversation", () => {
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
});

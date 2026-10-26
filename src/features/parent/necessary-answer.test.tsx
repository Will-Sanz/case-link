// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NecessaryAnswer } from "./necessary-answer";
import { PermissionEditor } from "./permission-editor";
import { fixtureRequest } from "@/lib/parent/test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const success = { ok: true, status: 200, json: async () => ({ ok: true }) };
describe("necessary personal input", () => {
  it("keeps a conflicting draft until explicit review, then uses the latest saved version", async () => {
    const request = fixtureRequest();
    request.intake.incomeFrequency = "weekly";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          ok: false,
          error: "This request changed. Review the latest information.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, request: { ...request, version: 2 } }),
      })
      .mockResolvedValue(success);
    vi.stubGlobal("fetch", fetch);
    render(
      <NecessaryAnswer
        request={request}
        action={{
          id: "income",
          reason: "missing_fact",
          need: "electricity",
          field: "incomeAmount",
          title: "Income",
          explanation: "Required",
        }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText(
      "Household income before taxes ($)",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("alert");
    expect(input.value).toBe("400");
    fireEvent.click(
      screen.getByRole("button", { name: "Review latest question" }),
    );
    await screen.findByText(/latest saved information is loaded/);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({
      version: 2,
      value: { amount: 450, frequency: "weekly" },
    });
  });
  it("saves zero current income and its frequency with the exact request version", async () => {
    const fetch = vi.fn().mockResolvedValue(success),
      onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      <NecessaryAnswer
        request={fixtureRequest({ version: 3 })}
        action={{
          id: "income",
          reason: "missing_fact",
          need: "electricity",
          field: "incomeAmount",
          title: "Income",
          explanation: "Required",
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Household income before taxes ($)"),
      { target: { value: "0" } },
    );
    fireEvent.change(
      screen.getByLabelText("How often is this income received?"),
      { target: { value: "biweekly" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: "answer_fact",
      need: "electricity",
      field: "income",
      value: { amount: 0, frequency: "biweekly" },
      version: 3,
    });
  });
  it("keeps an unsaved permission draft bound to its original version during progress refresh", async () => {
    const fetch = vi.fn().mockResolvedValue(success),
      onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const request = fixtureRequest(),
      { rerender } = render(
        <PermissionEditor request={request} onChange={onChange} />,
      );
    fireEvent.click(
      screen.getByRole("button", { name: "Change or renew permission" }),
    );
    fireEvent.click(
      screen.getByLabelText("Consented documents and extracted facts"),
    );
    rerender(
      <PermissionEditor
        request={{ ...request, version: 2 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/I authorize these programs/));
    fireEvent.click(
      screen.getByRole("button", { name: "Save updated permission" }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const packet = JSON.parse(fetch.mock.calls[0][1].body);
    expect(packet.version).toBe(1);
    expect(packet.mandate.allowedData).not.toContain("documents");
    expect(packet.action).toBe("replace_mandate");
  });
  it("preserves an existing income period and original answer version during polling", async () => {
    const fetch = vi.fn().mockResolvedValue(success);
    vi.stubGlobal("fetch", fetch);
    const request = fixtureRequest();
    request.intake.incomeFrequency = "weekly";
    const action = {
      id: "missing-income",
      reason: "missing_fact" as const,
      need: "electricity" as const,
      field: "incomeAmount",
      title: "Income",
      explanation: "Required",
    };
    const { rerender } = render(
      <NecessaryAnswer request={request} action={action} onChange={() => {}} />,
    );
    expect(
      (
        screen.getByLabelText(
          "How often is this income received?",
        ) as HTMLSelectElement
      ).value,
    ).toBe("weekly");
    fireEvent.change(
      screen.getByLabelText("Household income before taxes ($)"),
      { target: { value: "400" } },
    );
    rerender(
      <NecessaryAnswer
        request={{ ...request, version: 2 }}
        action={action}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      version: 1,
      value: { amount: 400, frequency: "weekly" },
    });
  });
});

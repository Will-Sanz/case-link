// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NecessaryAnswer } from "./necessary-answer";
import { PermissionEditor } from "./permission-editor";
import { fixtureNow, fixtureRequest } from "@/lib/parent/test-fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixtureNow);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const success = { ok: true, status: 200, json: async () => ({ ok: true }) };
describe("necessary personal input", () => {
  it("keeps a conflicting draft until explicit review, then uses the latest saved version", async () => {
    const request = fixtureRequest();
    request.intake.incomeAmount = 300;
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
    expect(input.value).toBe("300");
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
    const fetch = vi
        .fn()
        .mockImplementation(async (url: string) =>
          url.endsWith("/authorization-window")
            ? {
                ...success,
                json: async () => ({
                  ok: true,
                  authorization: { expiresAt: "2026-11-24T12:00:00.000Z" },
                }),
              }
            : success,
        ),
      onChange = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2028-01-01T00:00:00Z"));
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
    const packet = JSON.parse(fetch.mock.calls[1][1].body);
    expect(packet.version).toBe(1);
    expect(packet.mandate.allowedData).not.toContain("documents");
    expect(packet.action).toBe("replace_mandate");
    expect(packet.mandate.expiresAt).toBe("2026-11-24T12:00:00.000Z");
  });
  it("preserves an existing income period and original answer version during polling", async () => {
    const fetch = vi.fn().mockResolvedValue(success);
    vi.stubGlobal("fetch", fetch);
    const request = fixtureRequest();
    request.intake.incomeAmount = 300;
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
  it("prefills the exact need's paired income instead of another need's latest mirror", () => {
    const request = fixtureRequest();
    request.intake.needs = ["snap_new", "electricity"];
    request.intake.incomeAmount = 900;
    request.intake.incomeFrequency = "monthly";
    request.intake_need_scoped_fields = ["incomeAmount", "incomeFrequency"];
    request.facts = [
      { need: "snap_new", field: "income", value: { amount: 0, frequency: "weekly" }, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
      { need: "electricity", field: "income", value: { amount: 900, frequency: "monthly" }, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
    ];
    render(<NecessaryAnswer request={request} action={{ id: "snap-income", need: "snap_new", field: "income", reason: "missing_fact", title: "Income", explanation: "Required" }} onChange={() => {}} />);
    expect((screen.getByLabelText("Household income before taxes ($)") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("How often is this income received?") as HTMLSelectElement).value).toBe("weekly");
  });
  it.each([
    ["zip", "stale"], ["householdSize", "stale"],
    ["zip", "excluded"], ["householdSize", "excluded"],
  ] as const)("leaves %s blank when saved household facts are %s", (field, source) => {
    const request = fixtureRequest();
    const at = source === "stale" ? "2026-01-01T00:00:00Z" : fixtureNow.toISOString();
    request.intake_confirmed_at = { [field]: at };
    if (source === "excluded") request.mandate.allowedData = ["utility"];
    request.facts = [{ need: "electricity", field, value: field === "zip" ? "19103" : 8, source: "parent", confirmedAt: at, asOf: at.slice(0, 10) }];
    render(<NecessaryAnswer request={request} action={{ id: `current-${field}`, need: "electricity", field, reason: "missing_fact", title: "Current fact", explanation: "Required" }} onChange={() => {}} />);
    expect((screen.getByLabelText("Your answer") as HTMLInputElement).value).toBe("");
  });
  it.each(["stale", "excluded"])("does not combine or prefill an %s income pair", (source) => {
    const request = fixtureRequest();
    request.intake.incomeAmount = 900;
    request.intake.incomeFrequency = "monthly";
    const at = source === "stale" ? "2026-01-01T00:00:00Z" : fixtureNow.toISOString();
    request.intake_confirmed_at = { incomeAmount: at, incomeFrequency: at };
    if (source === "excluded") request.mandate.allowedData = ["household"];
    request.facts = [{ need: "electricity", field: "income", value: { amount: 700, frequency: "weekly" }, source: "parent", confirmedAt: at, asOf: at.slice(0, 10) }];
    render(<NecessaryAnswer request={request} action={{ id: "current-income", need: "electricity", field: "income", reason: "missing_fact", title: "Current income", explanation: "Required" }} onChange={() => {}} />);
    expect((screen.getByLabelText("Household income before taxes ($)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("How often is this income received?") as HTMLSelectElement).value).toBe("");
  });
  it("loads scoped paired values only after explicit latest review and submits the reviewed version", async () => {
    const request = fixtureRequest();
    request.intake.needs = ["snap_new", "electricity"];
    request.intake.incomeAmount = 100;
    request.intake.incomeFrequency = "monthly";
    const latest = structuredClone(request);
    latest.version = 2;
    latest.intake.incomeAmount = 900;
    latest.intake.incomeFrequency = "yearly";
    latest.intake_need_scoped_fields = ["incomeAmount", "incomeFrequency"];
    latest.facts = [{ need: "snap_new", field: "income", value: { amount: 250, frequency: "weekly" }, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Request changed." }) })
      .mockResolvedValueOnce({ ...success, json: async () => ({ request: latest }) })
      .mockResolvedValue(success);
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswer request={request} action={{ id: "review-snap-income", need: "snap_new", field: "income", reason: "missing_fact", title: "Income", explanation: "Required" }} onChange={() => {}} />);
    const amount = screen.getByLabelText("Household income before taxes ($)") as HTMLInputElement;
    const frequency = screen.getByLabelText("How often is this income received?") as HTMLSelectElement;
    fireEvent.change(amount, { target: { value: "444" } });
    fireEvent.change(frequency, { target: { value: "yearly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("alert");
    expect(amount.value).toBe("444");
    expect(frequency.value).toBe("yearly");
    fireEvent.click(screen.getByRole("button", { name: "Review latest question" }));
    await screen.findByText(/latest saved information is loaded/);
    expect(amount.value).toBe("250");
    expect(frequency.value).toBe("weekly");
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ version: 2, value: { amount: 250, frequency: "weekly" } });
  });
});

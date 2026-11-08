// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEED_LABELS, type NecessaryAction, type SupportNeed, type SupportRequest } from "@/lib/parent/domain";
import { fixtureIntake, fixtureNow, fixtureRequest } from "@/lib/parent/test-fixtures";
import { NecessaryAnswers } from "./necessary-answers";

const question = (field: string, need: SupportNeed = "electricity"): NecessaryAction => ({
  id: `${need}-${field}`, need, field, reason: "missing_fact", resolver: "parent",
  title: field, explanation: `Current ${field} for this support step.`,
});
const request = (fields = ["amountDue", "householdSize"]): SupportRequest => fixtureRequest({
  intake: fixtureIntake({ needs: ["electricity", "water"], utilityProviders: ["peco", "pwd"] }),
  required_actions: fields.map((field) => question(field)),
});
const reply = (saved: SupportRequest, status = 200) => ({
  ok: status < 400, status, json: async () => status < 400 ? { request: saved } : { error: "This request changed." },
});
function input(field: string, need: SupportNeed = "electricity") {
  const region = within(screen.getByRole("region", { name: `${NEED_LABELS[need]} ${field}` }));
  return region.getByLabelText(field === "income" ? "Household income before taxes ($)" : field === "accountAuthority" ? "How are you connected to the account?" : "Your answer") as HTMLInputElement | HTMLSelectElement;
}
const save = () => screen.getByRole("button", { name: "Save all answers and continue" });
const change = (field: string, value: string, need: SupportNeed = "electricity") => fireEvent.change(input(field, need), { target: { value } });
const packet = (fetch: ReturnType<typeof vi.fn>, index = 0) => JSON.parse(String(fetch.mock.calls[index][1].body));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixtureNow);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("one save for the family's known factual questions", () => {
  it("keeps an explicitly deferred prefilled answer blank after a partial save and refresh", async () => {
    const current = request(), onChange = vi.fn();
    const saved = { ...current, version: 2, required_actions: current.required_actions.map((action) => ({
      ...action, resolved: action.field === "amountDue",
    })) };
    const fetch = vi.fn().mockResolvedValue(reply(saved));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NecessaryAnswers request={current} onChange={onChange} />);
    expect(input("householdSize").value).toBe("3");
    change("householdSize", ""); change("amountDue", "15");
    fireEvent.click(save());
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(packet(fetch).answers).toEqual([{ need: "electricity", field: "amountDue", value: 15 }]);
    expect(input("householdSize").value).toBe("");
    rerender(<NecessaryAnswers request={saved} onChange={onChange} />);
    expect(input("householdSize").value).toBe("");
    expect(screen.getByText(/Unanswered questions stay open/)).toBeTruthy();
  });

  it("deduplicates income aliases, preserves need/anchor context and saves zero with one current bundle", async () => {
    const current = request(["incomeAmount", "incomeFrequency", "income"]);
    current.intake.incomeAmount = 900;
    current.intake.incomeFrequency = "monthly";
    current.intake_need_scoped_fields = ["incomeAmount", "incomeFrequency"];
    current.facts = [{ need: "electricity", field: "income", value: { amount: 0, frequency: "weekly" }, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
    current.required_actions.push(question("amountDue", "water"));
    const saved = { ...current, version: 2, required_actions: [] };
    const fetch = vi.fn().mockResolvedValue(reply(saved)), onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={onChange} />);
    expect(screen.getAllByLabelText("Household income before taxes ($)")).toHaveLength(1);
    expect((screen.getByLabelText("Household income before taxes ($)") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("How often is this income received?") as HTMLSelectElement).value).toBe("weekly");
    for (const field of ["incomeAmount", "incomeFrequency", "income"])
      expect(document.getElementById(`step-electricity-${field}`)).toBeTruthy();
    change("amountDue", "0", "water");
    fireEvent.click(save());
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(packet(fetch)).toEqual({ action: "answer_facts", version: 1, answers: [
      { need: "electricity", field: "income", value: { amount: 0, frequency: "weekly" } },
      { need: "water", field: "amountDue", value: 0 },
    ] });
    expect(screen.queryByRole("button", { name: "Save all answers and continue" })).toBeNull();
  });

  it("includes only unresolved parent-owned supported facts, leaving other actions separate", () => {
    const current = request([]);
    current.required_actions = [
      { ...question("amountDue"), resolved: true },
      { ...question("totalBalance"), resolver: "operator" },
      { ...question("dueDate"), reason: "personal_step" },
      { ...question("zip"), reason: "expanded_permission" },
      { ...question("accountAuthority"), reason: "qualified_help" },
      question("bookingPreference"), question("unsupported-field"),
    ];
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Save all answers and continue" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each(["paused", "cancelled"] as const)("does not save known facts while the request is %s", (status) => {
    const current = { ...request(), status };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect(input("amountDue").matches(":disabled")).toBe(true);
    fireEvent.submit(save().closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["amount", "frequency"] as const)("blocks every write for partial income missing its %s", (missing) => {
    const current = request(["amountDue", "income"]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    expect(input("income").value).toBe("");
    const frequency = screen.getByLabelText("How often is this income received?");
    if (missing === "amount") fireEvent.change(frequency, { target: { value: "monthly" } });
    else change("income", "100");
    fireEvent.submit(save().closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
    expect(input("income").value).toBe(missing === "amount" ? "" : "100");
    expect(input("amountDue").value).toBe("15");
    expect(screen.getByRole("alert").textContent).toContain("Electric bill: income");
    expect(document.activeElement).toBe(missing === "amount" ? input("income") : frequency);
  });

  it("does not send an entirely unanswered question list", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={request(["amountDue"])} onChange={() => {}} />);
    fireEvent.click(save());
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("at least one answer");
  });

  it("saves a known food answer while an unanswered utility question remains open", async () => {
    const current = request([]);
    current.intake.needs = ["food_now", "electricity"];
    current.intake.householdSize = null;
    current.required_actions = [question("householdSize", "food_now"), question("amountDue"), question("income")];
    const saved = { ...current, version: 2, required_actions: [question("amountDue"), question("income")] };
    const fetch = vi.fn().mockResolvedValue(reply(saved)), onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={onChange} />);
    change("householdSize", "4", "food_now");
    expect(input("amountDue").required).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(packet(fetch)).toEqual({ action: "answer_facts", version: 1, answers: [
      { need: "food_now", field: "householdSize", value: 4 },
    ] });
    expect(input("amountDue").value).toBe("");
    expect(input("income").value).toBe("");
    expect(screen.getByText(/Unanswered questions stay open/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Food for now householdSize" })).toBeNull();
  });

  it("validates every input before sending any part of the bundle", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={request()} onChange={() => {}} />);
    change("amountDue", "-1");
    change("householdSize", "4");
    fireEvent.submit(save().closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
    expect(input("householdSize").value).toBe("4");
  });

  it("names and focuses the invalid question when two needs use the same input label", () => {
    const current = request([]), fetch = vi.fn();
    current.required_actions = [question("zip"), question("zip", "water")];
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("zip", "19104");
    change("zip", "abcde", "water");
    fireEvent.submit(save().closest("form")!);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Water bill: zip");
    expect(document.activeElement).toBe(input("zip", "water"));
    expect(input("zip").value).toBe("19104");
  });

  it("preserves all dirty drafts and the original version during progress refresh", async () => {
    const current = request(), fetch = vi.fn().mockResolvedValue(reply({ ...current, version: 2, required_actions: [] }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    change("householdSize", "4");
    rerender(<NecessaryAnswers request={{ ...current, version: 2, intake: { ...current.intake, householdSize: 8 }, required_actions: [...current.required_actions, question("zip")] }} onChange={() => {}} />);
    expect(input("amountDue").value).toBe("15");
    expect(input("householdSize").value).toBe("4");
    expect(screen.queryByRole("region", { name: "Electric bill zip" })).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(packet(fetch)).toMatchObject({ version: 1, answers: [
      { need: "electricity", field: "amountDue", value: 15 }, { need: "electricity", field: "householdSize", value: 4 },
    ] });
  });

  it("adds a newly known same-version question without replacing the existing draft", async () => {
    const current = request(["amountDue"]);
    const fetch = vi.fn().mockResolvedValue(reply({ ...current, version: 2, required_actions: [] }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    rerender(<NecessaryAnswers request={{ ...current, required_actions: [...current.required_actions, question("householdSize")] }} onChange={() => {}} />);
    expect(input("amountDue").value).toBe("15");
    change("householdSize", "4");
    fireEvent.click(save());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(packet(fetch)).toEqual({ action: "answer_facts", version: 1, answers: [
      { need: "electricity", field: "amountDue", value: 15 },
      { need: "electricity", field: "householdSize", value: 4 },
    ] });
  });

  it("adopts newly arriving questions and version when no factual draft has ever started", async () => {
    const current = request([]);
    const next = { ...request(["amountDue"]), version: 2 };
    const fetch = vi.fn().mockResolvedValue(reply({ ...next, version: 3, required_actions: [] }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<NecessaryAnswers request={current} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Save all answers and continue" })).toBeNull();
    rerender(<NecessaryAnswers request={next} onChange={() => {}} />);
    change("amountDue", "15");
    fireEvent.click(save());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(packet(fetch)).toEqual({ action: "answer_facts", version: 2, answers: [{ need: "electricity", field: "amountDue", value: 15 }] });
  });

  it("disables controls while pending and submits one frozen snapshot", async () => {
    const current = request();
    let finish!: (value: ReturnType<typeof reply>) => void;
    const fetch = vi.fn(() => new Promise<ReturnType<typeof reply>>((resolve) => { finish = resolve; }));
    const onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={onChange} />);
    change("amountDue", "15");
    change("householdSize", "4");
    const button = save();
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(input("amountDue").matches(":disabled")).toBe(true);
    expect(input("householdSize").matches(":disabled")).toBe(true);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(packet(fetch).answers[0].value).toBe(15);
    finish(reply({ ...current, version: 2, required_actions: [] }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  });

  it("keeps every draft on conflict and loads scoped current questions only after explicit review", async () => {
    const current = request(["amountDue", "income"]);
    const latest = request(["income", "zip"]);
    latest.version = 2;
    latest.intake.incomeAmount = 900;
    latest.intake.incomeFrequency = "yearly";
    latest.intake_need_scoped_fields = ["incomeAmount", "incomeFrequency"];
    latest.facts = [{ need: "electricity", field: "income", value: { amount: 250, frequency: "weekly" }, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
    const fetch = vi.fn().mockResolvedValueOnce(reply(current, 409)).mockResolvedValueOnce(reply(latest)).mockResolvedValue(reply({ ...latest, version: 3, required_actions: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    change("income", "444");
    fireEvent.change(screen.getByLabelText("How often is this income received?"), { target: { value: "monthly" } });
    fireEvent.click(save());
    await screen.findByRole("alert");
    expect(input("amountDue").value).toBe("15");
    expect(input("income").value).toBe("444");
    fireEvent.click(screen.getByRole("button", { name: "Review latest questions" }));
    await waitFor(() => expect(input("income").value).toBe("250"));
    expect((screen.getByLabelText("How often is this income received?") as HTMLSelectElement).value).toBe("weekly");
    expect(screen.queryByRole("region", { name: "Electric bill amountDue" })).toBeNull();
    expect(input("zip").value).toBe("19104");
    expect(document.activeElement).toBe(input("income"));
    fireEvent.click(save());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(packet(fetch, 2)).toMatchObject({ version: 2, answers: [
      { need: "electricity", field: "income", value: { amount: 250, frequency: "weekly" } }, { need: "electricity", field: "zip", value: "19104" },
    ] });
  });

  it("keeps all typed values if the explicit latest-question reload fails", async () => {
    const current = request(), fetch = vi.fn().mockResolvedValueOnce(reply(current, 409)).mockRejectedValueOnce(new Error("Disconnected"));
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    change("householdSize", "4");
    fireEvent.click(save());
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Review latest questions" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Review latest questions" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(input("amountDue").value).toBe("15");
    expect(input("householdSize").value).toBe("4");
  });

  it.each(["network", "missing_request", "malformed_json", "upstream_503"])("preserves the whole draft after an unknown %s acknowledgement and reconciles before another save", async (source) => {
    const current = request();
    const fetch = vi.fn().mockImplementationOnce(async () => {
      if (source === "network") throw new Error("Disconnected");
      if (source === "malformed_json") return { ok: true, status: 200, json: async () => { throw new SyntaxError("Truncated response"); } };
      if (source === "upstream_503") return reply(current, 503);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }).mockResolvedValue(reply({ ...current, version: 2, required_actions: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    change("householdSize", "4");
    fireEvent.click(save());
    await screen.findByRole("alert");
    expect(input("amountDue").value).toBe("15");
    expect(input("householdSize").value).toBe("4");
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save());
    fireEvent.submit(save().closest("form")!);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Review latest questions" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1]?.method ?? "GET").toBe("GET");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save all answers and continue" })).toBeNull());
  });

  it("uses the returned paused state for remaining questions while the parent refresh is pending", async () => {
    const current = request(["amountDue"]);
    const saved = { ...current, status: "paused" as const, version: 2, required_actions: [question("householdSize")] };
    const fetch = vi.fn().mockResolvedValue(reply(saved)), onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={onChange} />);
    change("amountDue", "15");
    fireEvent.click(save());
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(input("householdSize").matches(":disabled")).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(save().closest("form")!);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clears only same-account drafts and omits them from a partial save even after provider change back", async () => {
    const dependent = ["amountDue", "totalBalance", "dueDate", "shutoffDate", "accountAuthority"];
    const current = request(["utilityProvider", ...dependent, "householdSize", "income"]);
    current.intake.incomeAmount = 100;
    current.intake.incomeFrequency = "weekly";
    current.required_actions.push(question("amountDue", "water"));
    current.facts = [{ need: "electricity", field: "utilityProvider", value: "peco", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
    const fetch = vi.fn().mockResolvedValue(reply({ ...current, version: 2, required_actions: dependent.map((field) => question(field)) }));
    const onChange = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<NecessaryAnswers request={current} onChange={onChange} />);
    for (const [field, value] of [["amountDue", "15"], ["totalBalance", "30"], ["dueDate", "2026-10-30"], ["shutoffDate", "2026-10-31"], ["accountAuthority", "self"]]) change(field, value);
    change("amountDue", "77", "water");
    change("householdSize", "4");
    change("income", "200");
    change("utilityProvider", "other");
    for (const field of dependent) expect(input(field).value).toBe("");
    expect(input("householdSize").value).toBe("4");
    expect(input("income").value).toBe("200");
    expect(input("amountDue", "water").value).toBe("77");
    change("utilityProvider", "peco");
    for (const field of dependent) expect(input(field).value).toBe("");
    fireEvent.submit(save().closest("form")!);
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(packet(fetch)).toEqual({ action: "answer_facts", version: 1, answers: [
      { need: "electricity", field: "utilityProvider", value: "peco" },
      { need: "electricity", field: "householdSize", value: 4 },
      { need: "electricity", field: "income", value: { amount: 200, frequency: "weekly" } },
      { need: "water", field: "amountDue", value: 77 },
    ] });
  });

  it("keeps known account drafts when first resolving an unknown provider", () => {
    const current = request(["utilityProvider", "amountDue"]);
    current.intake.utilityProviders = ["unknown"];
    render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("amountDue", "15");
    change("utilityProvider", "peco");
    expect(input("amountDue").value).toBe("15");
  });

  it("starts a newly known account question blank after an unsaved same-need provider change", () => {
    const current = request(["utilityProvider", "amountDue"]);
    current.facts = [
      { need: "electricity", field: "utilityProvider", value: "peco", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
      { need: "electricity", field: "totalBalance", value: 80, source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
    ];
    const { rerender } = render(<NecessaryAnswers request={current} onChange={() => {}} />);
    change("utilityProvider", "other");
    rerender(<NecessaryAnswers request={{ ...current, required_actions: [...current.required_actions, question("totalBalance")] }} onChange={() => {}} />);
    expect(input("utilityProvider").value).toBe("other");
    expect(input("totalBalance").value).toBe("");
    change("utilityProvider", "peco");
    expect(input("totalBalance").value).toBe("");
  });
});

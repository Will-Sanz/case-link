// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { PermissionEditor } from "./permission-editor";
import { NecessaryAnswer } from "./necessary-answer";
import { NecessaryAnswers } from "./necessary-answers";
import { withSupportUpdateReceipts } from "./support-update-test-server";
import { useSupportUpdate } from "./use-support-update";
import { SupportUpdateRecovery } from "./support-update-recovery";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([false, true])("links to the existing parent Help route when accessLost=%s", accessLost => {
  expect(existsSync(resolve(process.cwd(), "src/app/(parent)/support/help/page.tsx"))).toBe(true);
  const { result } = renderHook(() => useSupportUpdate(fixtureRequest().id, vi.fn()));
  render(<SupportUpdateRecovery recovery={{ ...result.current, accessLost, unresolved: !accessLost }} onReview={vi.fn()}/>);
  expect(screen.getByRole("link", { name: "Help and manual options" }).getAttribute("href")).toBe("/support/help");
});
it("freezes every accepted permission control while its first write is pending", async () => {
  const request = fixtureRequest();
  let posted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posted = true; return new Promise(() => {}); }
    return { ok: true, status: 200, json: async () => ({ request,
      authorization: { expiresAt: new Date(Date.now()+86400000).toISOString() },
      update: { ownerId: "11111111-1111-4111-8111-111111111111", receipt: null, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86400000).toISOString() } }) };
  }));
  render(<PermissionEditor request={request} onChange={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button", { name: "Change or renew permission" }));
  fireEvent.click(screen.getByLabelText(/I authorize these programs/));
  fireEvent.click(screen.getByRole("button", { name: "Save updated permission" }));
  await waitFor(() => expect(posted).toBe(true));
  for (const input of screen.getAllByRole("checkbox")) expect(input.matches(":disabled")).toBe(true);
  for (const input of screen.getAllByRole("radio")) expect(input.matches(":disabled")).toBe(true);
});
it("does not discard permission editing in a different request when an older save replies", async () => {
  const first = fixtureRequest(); const next = { ...first, id: "22222222-2222-4222-8222-222222222222" };
  let resolve!: (value: unknown) => void;
  const onChange = vi.fn(); let posted = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posted = true; return new Promise(done => { resolve = done; }); }
    return { ok: true, status: 200, json: async () => ({ request: first,
      authorization: { expiresAt: new Date(Date.now()+86400000).toISOString() },
      update: { ownerId: "11111111-1111-4111-8111-111111111111", receipt: null, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+86400000).toISOString() } }) };
  }));
  const { rerender } = render(<PermissionEditor request={first} onChange={onChange}/>);
  fireEvent.click(screen.getByRole("button", { name: "Change or renew permission" }));
  fireEvent.click(screen.getByLabelText(/I authorize these programs/));
  fireEvent.click(screen.getByRole("button", { name: "Save updated permission" }));
  await waitFor(() => expect(posted).toBe(true));
  rerender(<PermissionEditor request={next} onChange={onChange}/>);
  resolve({ ok: true, status: 200, json: async () => ({ ok: true, request: first }) });
  await new Promise(done => setTimeout(done, 5));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByText("Your updated permission is saved. Future work uses these limits.")).toBeNull();
});
it("reconciles a partially answered bundle without discarding an explicitly deferred draft", async () => {
  const request = fixtureRequest({ required_actions: ["amountDue", "householdSize"].map(field => ({ id: field, need: "electricity", field, reason: "missing_fact", resolver: "parent", title: field, explanation: "Current fact" })) });
  const writes = vi.fn().mockRejectedValue(new Error("lost response")), onChange = vi.fn();
  vi.stubGlobal("fetch", withSupportUpdateReceipts(writes, request, { commitUnknown: true }));
  render(<NecessaryAnswers request={request} onChange={onChange}/>);
  fireEvent.change(document.getElementById("answer-householdSize")!, { target: { value: "" } });
  fireEvent.change(document.getElementById("answer-amountDue")!, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save all answers and continue" }));
  await screen.findByRole("alert"); expect(onChange).not.toHaveBeenCalled();
  expect((document.getElementById("answer-amountDue") as HTMLInputElement).value).toBe("0");
  expect(document.getElementById("answer-householdSize")!.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check saved result" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect((document.getElementById("answer-householdSize") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("amountDue")).toBeNull(); expect(writes).toHaveBeenCalledTimes(1);
  expect(JSON.parse(writes.mock.calls[0][1].body).answers).toEqual([{ need: "electricity", field: "amountDue", value: 0 }]);
});
it("keeps an unknown booking choice fixed and checks its original receipt before claiming it saved", async () => {
  const request = fixtureRequest(), writes = vi.fn().mockRejectedValue(new Error("lost response")), onChange = vi.fn();
  vi.stubGlobal("fetch", withSupportUpdateReceipts(writes, request, { commitUnknown: true }));
  render(<NecessaryAnswer request={request} action={{ id: "booking", need: "food_now", reason: "meaningful_choice", field: "bookingPreference", title: "Choose time", explanation: "Your choice" }} onChange={onChange}/>);
  const input = screen.getByLabelText("Preferred appointment window") as HTMLSelectElement;
  fireEvent.change(input, { target: { value: "weekday_afternoon" } }); fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByRole("alert"); expect(input.disabled).toBe(true); expect(input.value).toBe("weekday_afternoon"); expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check saved result" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce()); expect(writes).toHaveBeenCalledOnce();
  expect(JSON.parse(writes.mock.calls[0][1].body)).toEqual({ action: "booking_preference", version: 1, preference: "weekday_afternoon" });
});
it("leaves and reopens uncertain permission without replacing the accepted body or quoting another deadline", async () => {
  const request = fixtureRequest(), onChange = vi.fn(), expiresAt = "2026-11-24T12:00:00Z";
  const writes = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("authorization-window")) return { ok: true, status: 200, json: async () => ({ authorization: { expiresAt } }) };
    throw new Error("lost response");
  });
  vi.stubGlobal("fetch", withSupportUpdateReceipts(writes, request, { permission: true, commitUnknown: true }));
  render(<PermissionEditor request={request} onChange={onChange}/>);
  fireEvent.click(screen.getByRole("button", { name: "Change or renew permission" }));
  fireEvent.click(screen.getByLabelText("Consented documents and extracted facts"));
  fireEvent.click(screen.getByLabelText(/I authorize these programs/)); fireEvent.click(screen.getByRole("button", { name: "Save updated permission" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Close editor; this save is still being checked" }));
  fireEvent.click(screen.getByRole("button", { name: "Change or renew permission" }));
  expect((screen.getByLabelText(/I authorize these programs/) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByLabelText("Consented documents and extracted facts").matches(":disabled")).toBe(true);
  expect((screen.getByLabelText("Consented documents and extracted facts") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Check saved result" })); await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(writes).toHaveBeenCalledTimes(2); expect(writes.mock.calls.filter(([url]) => url.endsWith("authorization-window"))).toHaveLength(1);
  expect(JSON.parse(writes.mock.calls[1][1].body).mandate.expiresAt).toBe(expiresAt);
});

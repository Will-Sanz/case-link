// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { FloatingAssistant } from "./floating-assistant";
import { ParentLocaleProvider } from "./parent-locale";
let pathname = "/my-support";
let mobile = false;
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ refresh() {} }) }));
const first = fixtureRequest({ intake: { ...fixtureRequest().intake, needs: ["snap_new"] } });
const second = fixtureRequest({ id: "a430cc02-d8d4-46cc-9900-5b397758fb16", intake: { ...fixtureRequest().intake, needs: ["water"] } });
const conversation = { messages: [], available: true, unavailableReason: null, historyLimited: false };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  pathname = "/my-support"; mobile = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  for (const name of ["show", "showModal", "close"] as const) Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true, value: vi.fn(function (this: HTMLDialogElement) {
      if (name === "close") this.removeAttribute("open"); else this.setAttribute("open", "");
    }),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Ask CaseLink for assistance" }));
it("offers Spanish account request selection without changing service language or loading context before opening", async () => {
  const fetch = stubRequests();
  render(<ParentLocaleProvider initialLocale="es"><FloatingAssistant signedIn /></ParentLocaleProvider>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Pedir ayuda a CaseLink" }));
  fireEvent.change(await screen.findByLabelText("¿Con qué solicitud necesita ayuda?"), { target: { value: first.id } });
  expect(await screen.findByText(/Su solicitud de SNAP ·/, { selector: "p" })).toBeTruthy();
  expect(first.intake.language).toBe("en");
});
function stubRequests(requests = [first, second]) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return json({ ok: true, id: "accepted" });
    if (url.endsWith("/assistant")) return json(conversation);
    const request = requests.find((item) => url.endsWith(`/${item.id}`));
    return json(request ? { request } : { requests });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
it.each(["/", "/account", "/get-support", "/my-support"])("offers request selection then a plain composer on %s", async path => {
  pathname = path;
  const fetch = stubRequests(); render(<FloatingAssistant signedIn />);
  expect(fetch).not.toHaveBeenCalled(); open();
  const picker = await screen.findByLabelText("Which request can we help with?");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.change(picker, { target: { value: second.id } });
  const input = await screen.findByRole("textbox", { name: "Your question about this request" });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByLabelText("Question suggestions")).toBeNull();
  expect(screen.queryByLabelText("Application website status")).toBeNull();
  fireEvent.change(input, { target: { value: "What information have I already provided?" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe(`/api/parent/requests/${second.id}/assistant`);
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ question: "What information have I already provided?", consented: true });
  });
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/browser"))).toBe(false);
});
it("preselects the detail request and clears its draft and history when switching requests", async () => {
  pathname = `/support/${first.id}`; const fetch = stubRequests();
  render(<FloatingAssistant signedIn />); open();
  const input = await screen.findByRole("textbox");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(first.id);
  fireEvent.change(input, { target: { value: "Only about SNAP" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: second.id } });
  await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
  expect(fetch.mock.calls.some(([url]) => url === `/api/parent/requests/${second.id}/assistant`)).toBe(true);
});
it("ignores a late response after the selected request changes", async () => {
  let finish!: (value: ReturnType<typeof json>) => void;
  const delayed = new Promise<ReturnType<typeof json>>(resolve => { finish = resolve; });
  const fetch = stubRequests();
  fetch.mockImplementation(async (url: string) => url.endsWith(`/${first.id}`) ? delayed
    : json(url.endsWith("/assistant") ? conversation : url.endsWith(`/${second.id}`) ? { request: second } : { requests: [first, second] }));
  render(<FloatingAssistant signedIn />); open();
  const picker = await screen.findByRole("combobox");
  fireEvent.change(picker, { target: { value: first.id } }); await screen.findByText("Loading this request…");
  fireEvent.change(picker, { target: { value: second.id } }); await screen.findByRole("textbox");
  finish(json({ request: first }));
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(second.id));
  expect(screen.queryByText("Loading this request…")).toBeNull();
});
it("keeps a sole request selectable and preserves the draft after minimizing", async () => {
  stubRequests([first]); render(<FloatingAssistant signedIn />); open();
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "What happens next?" } });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask CaseLink for assistance" }));
  open(); expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("What happens next?");
  expect(screen.getByRole("combobox")).toBeTruthy();
});
it("lets the family hide the floating button without losing an unfinished question", async () => {
  stubRequests([first]); render(<FloatingAssistant signedIn />); open();
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Keep this unfinished question" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide assistant button" }));
  expect(screen.queryByRole("button", { name: "Ask CaseLink for assistance" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show CaseLink assistant" }));
  expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this unfinished question");
});
it("preserves modal cancellation and keyboard focus on a phone", async () => {
  mobile = true; stubRequests([first]);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 100, 44)] as unknown as DOMRectList);
  render(<FloatingAssistant signedIn />); open(); await screen.findByRole("textbox");
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  const close = screen.getByRole("button", { name: "Minimize chat" }); close.focus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
  fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(document.activeElement).toBe(close);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps anonymous help public and never loads account context", async () => {
  const fetch = stubRequests(); render(<FloatingAssistant signedIn={false} />); open();
  expect(screen.queryByRole("textbox")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /Start SNAP on Pennsylvania/ })).toBeTruthy();
});
it("shows recovery and removes the composer when request access is denied", async () => {
  const fetch = stubRequests([first]);
  fetch.mockImplementation(async (url: string) => url === "/api/parent/requests" ? json({ requests: [first] }) : json({ error: "Sign in again" }, 401));
  render(<FloatingAssistant signedIn />); open();
  await screen.findByRole("link", { name: "Sign in to continue" });
  expect(screen.queryByRole("textbox")).toBeNull();
});

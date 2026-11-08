// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentAccount } from "./account";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("parent account deletion during processing closure", () => {
  it("offers owned deletion after ordinary account reads close, without showing household/export/preferences data", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ok:false,error:"Processing is closed."},503)).mockResolvedValueOnce(response({ok:true,ownerId:"11111111-1111-4111-8111-111111111111",status:"active"}));
    vi.stubGlobal("fetch",fetchMock);render(<ParentAccount/>);
    expect(await screen.findByLabelText("Type DELETE to confirm")).toBeTruthy();
    expect(screen.queryByLabelText("Support updates")).toBeNull();
    expect(screen.queryByRole("link",{name:"Download my information"})).toBeNull();
    expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(["/api/parent/account","/api/parent/account/deletion"]);
  });
  it("uses only deletion metadata in the rights return view, requires exact confirmation, and announces recorded cleanup with sign-out failure preserved", async () => {
    const fetchMock=vi.fn().mockResolvedValueOnce(response({ok:true,ownerId:"11111111-1111-4111-8111-111111111111",status:"active"})).mockResolvedValueOnce(response({ok:true})).mockRejectedValueOnce(new Error("network lost"));
    vi.stubGlobal("fetch",fetchMock);render(<ParentAccount deletionOnly/>);
    const input=await screen.findByLabelText("Type DELETE to confirm");
    const button=screen.getByRole("button",{name:"Delete parent-support data & stop work"}) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(input,{target:{value:"DELETE"}});fireEvent.click(button);
    const result=await screen.findByRole("heading",{name:"Your deletion request is recorded"});
    await waitFor(()=>expect(document.activeElement).toBe(result));
    expect(screen.getByText(/Private files and eligible parent records enter the deletion process/)).toBeTruthy();
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("couldn’t confirm sign-out"));
    expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(["/api/parent/account/deletion","/api/parent/account","/api/parent/auth"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({action:"delete",confirmation:"DELETE",expectedOwnerId:"11111111-1111-4111-8111-111111111111"});
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({action:"sign_out"});
  });
  it.each([
    [409, "Your signed-in account changed. Reload before confirming deletion."],
    [500, "We couldn’t record your deletion request. Please try again."],
  ])("shows a rejected deletion (%s) without claiming success or signing out", async (status, error) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, ownerId: "11111111-1111-4111-8111-111111111111", status: "active" }))
      .mockResolvedValueOnce(response({ ok: false, error }, status));
    vi.stubGlobal("fetch", fetchMock); render(<ParentAccount deletionOnly />);
    fireEvent.change(await screen.findByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete parent-support data & stop work" }));
    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(screen.queryByRole("heading", { name: "Your deletion request is recorded" })).toBeNull();
    expect((screen.getByRole("button", { name: "Delete parent-support data & stop work" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/parent/account/deletion", "/api/parent/account"]);
  });
  it("offers a specific deletion sign-in for a missing session rather than enrolling a parent",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(response({ok:false,error:"Sign in again."},401));vi.stubGlobal("fetch",fetchMock);
    render(<ParentAccount deletionOnly/>);
    expect((await screen.findByRole("link",{name:"Sign in for deletion"})).getAttribute("href")).toBe("/sign-in?purpose=delete-parent-data");
    expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("recovers an already recorded deletion from metadata without repeating deletion or extending retention",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(response({ok:true,ownerId:"11111111-1111-4111-8111-111111111111",status:"deletion_requested"}));vi.stubGlobal("fetch",fetchMock);
    render(<ParentAccount deletionOnly/>);
    await screen.findByRole("heading",{name:"Your deletion request is recorded"});
    expect(fetchMock).toHaveBeenCalledOnce();expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
  });
  it("does not expose a deletion form for unrecognized ownership metadata",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({ok:true,ownerId:"11111111-1111-4111-8111-111111111111",status:"unknown"})));
    render(<ParentAccount deletionOnly/>);await screen.findByRole("alert");
    expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
  });
});

it.each([409, 500])("keeps a late deletion failure visible after its confirmation disclosure closes (%s)", async status => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const error = status === 409 ? "Your signed-in account changed. Reload before confirming deletion." : "We couldn’t record your deletion request. Please try again.";
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({ ok: true, ownerId: "11111111-1111-4111-8111-111111111111", status: "active" }))
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock); render(<ParentAccount deletionOnly />);
  fireEvent.change(await screen.findByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete parent-support data & stop work" }));
  await screen.findByRole("button", { name: "Recording deletion…" });
  const summary = screen.getByText("Delete my parent-support data & stop future work"), details = summary.closest("details")!;
  fireEvent.click(summary); await waitFor(() => expect(details.open).toBe(false));
  await act(async () => { resolve(response({ ok: false, error }, status)); });
  const alert = await screen.findByRole("alert"); expect(alert.textContent).toBe(error); expect(alert.closest("details")).toBeNull();
  expect(details.open).toBe(false); expect(screen.queryByRole("heading", { name: "Your deletion request is recorded" })).toBeNull();
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/parent/account/deletion", "/api/parent/account"]);
});

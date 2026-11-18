// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileLeaves, type FamilyProfileDetails, type FamilyProfileRead } from "@/lib/parent/family-profile";
import type { SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import type { WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { useSavedFamilyProfile } from "./use-saved-family-profile";
const owner = "11111111-1111-4111-8111-111111111111", person = "22222222-2222-4222-8222-222222222222", child = "33333333-3333-4333-8333-333333333333";
const original: SnapApplicationFields = { applicant: { firstName: "OldCanary", lastName: "ManualFamily" }, zip: "19104", household: [{ id: person, firstName: "OldCanary", relationship: "SELF" }], income: { month: "2026-11", hasIncome: false } };
function read(details: FamilyProfileDetails = { primaryPerson: { id: person, firstName: "CurrentCanary", lastName: "ProfileFamily" }, homeAddress: { zip: "19147" } }, revision = 2): FamilyProfileRead {
  return { ownerId: owner, revision, lastMutationKey: child, collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-11-20T20:00:00Z", retentionDays: 45 }, profile: { revision, details, idempotencyKey: child, provenance: Object.fromEntries(Object.keys(familyProfileLeaves(details)).map(path => [path, { confirmedAt: "2026-11-01T15:00:00Z", expiresAt: "2026-12-01T15:00:00Z" }])) } };
}
const bindings = [ { applicationPath: "applicant.firstName", profilePaths: ["primaryPerson.firstName"] }, { applicationPath: `household.${person}.firstName`, profilePaths: ["primaryPerson.firstName"] }, { applicationPath: "zip", profilePaths: ["homeAddress.zip"] } ];
function api(fields = bindings) {
  const state = { read: read(), owner, unavailable: false };
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    expect(init?.method).not.toBe("POST");
    if (state.unavailable) throw new Error("offline");
    const body = url.includes("/family-profile-source?") ? { ok: true, fields } : url.endsWith("/account") ? { account: { id: state.owner } } : { ok: true, ...state.read };
    return { ok: true, status: 200, json: async () => body };
  }); vi.stubGlobal("fetch", fetcher); return { state, fetcher };
}
function setup(program: "snap-pa" | "wic-pa" = "snap-pa") {
  const changed = vi.fn(), request = fixtureRequest();
  const hook = renderHook(({ version }) => useSavedFamilyProfile({ request: { ...request, version }, snapshotId: person, permitted: true, program, onOwnerChanged: changed }), { initialProps: { version: request.version } });
  return { ...hook, changed };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T15:00:00Z")); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("owned saved food application family sources", () => {
  it("refreshes only linked SNAP facts and carries exact source pairs without inventing programme answers", async () => {
    api(); const { result } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; });
    expect(value).toEqual({ ...original, applicant: { firstName: "CurrentCanary", lastName: "ManualFamily" }, zip: "19147", household: [{ ...original.household![0], firstName: "CurrentCanary" }] });
    let source; await act(async () => { source = await result.current.source({ ...value, applicant: { ...value.applicant, firstName: "ManualCorrection" } }, new AbortController().signal); });
    expect(source).toEqual({ expectedOwnerId: owner, revision: 2, fields: bindings.slice(1) });
    expect(original.applicant!.firstName).toBe("OldCanary");
  });
  it("refreshes only an existing explicitly chosen WIC child and leaves beneficiary, mother and unbound contact choices alone", async () => {
    const fields = [{ applicationPath: `children.${child}.firstName`, profilePaths: [`members.${child}.firstName`] }], { state } = api(fields);
    state.read = read({ primaryPerson: { id: person, firstName: "ContactCanary" }, members: [{ id: child, firstName: "FreshChild" }, { id: owner, firstName: "UnchosenChild" }] });
    const { result } = setup("wic-pa"), saved: WicApplicationFields = { beneficiaries: "children", contact: { firstName: "ManualContact" }, mother: { firstName: "ManualMother" }, children: [{ id: child, firstName: "OldChild" }] };
    let value!: WicApplicationFields; await act(async () => { value = (await result.current.load(saved))!; });
    expect(value).toEqual({ ...saved, children: [{ id: child, firstName: "FreshChild" }] });
    let source; await act(async () => { source = await result.current.source(value, new AbortController().signal); });
    expect(source).toEqual({ expectedOwnerId: owner, revision: 2, fields, options: { wicChildIds: [child] } });
  });
  it("requires a known-no-write refresh after profile correction and preserves manual changes while refreshing other linked facts", async () => {
    const { state } = api(), { result } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; });
    value = { ...value, applicant: { ...value.applicant, firstName: "TypedCanary" } };
    state.read = read({ primaryPerson: { id: person, firstName: "NewProfileCanary" }, homeAddress: { zip: "19146" } }, 3);
    await act(async () => { await expect(result.current.source(value, new AbortController().signal)).rejects.toMatchObject({ status: 412 }); });
    await act(async () => { value = (await result.current.load(value))!; });
    expect(value.applicant!.firstName).toBe("TypedCanary"); expect(value.household![0].firstName).toBe("NewProfileCanary"); expect(value.zip).toBe("19146"); expect(value.income).toEqual(original.income);
  });
  it("keeps earlier saved dates when the profile was cleared, without supplying a new source token", async () => {
    const { state } = api(); state.read = { ...state.read, profile: null };
    const { result } = setup(); let value; await act(async () => { value = await result.current.load(original); });
    expect(value).toEqual(original); expect(result.current.notice).toMatch(/earlier saved values keep their original dates/);
    await expect(result.current.source(original, new AbortController().signal)).resolves.toBeUndefined();
  });
  it("cannot turn expired automatic values into fresh typed values even when GET redacts them without a revision bump", async () => {
    const { state } = api(), { result } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; });
    state.read = read({ primaryPerson: { id: person } });
    await act(async () => { await expect(result.current.source(value, new AbortController().signal)).rejects.toMatchObject({ status: 412 }); });
    await act(async () => { value = (await result.current.load(value))!; });
    expect(value).toEqual(original); await expect(result.current.source(value, new AbortController().signal)).resolves.toBeUndefined();
  });
  it("requires a refresh when profile permission expires while the draft remains open", async () => {
    const { state } = api(), { result } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; });
    vi.setSystemTime(new Date(state.read.collection.expiresAt!));
    await act(async () => { await expect(result.current.source(value, new AbortController().signal)).rejects.toMatchObject({ status: 412 }); });
    await act(async () => { value = (await result.current.load(value))!; });
    expect(value).toEqual(original); await expect(result.current.source(value, new AbortController().signal)).resolves.toBeUndefined();
  });
  it("retains source context across a failed refresh so automatic values cannot silently become typed facts", async () => {
    const { state } = api(), { result } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; }); state.unavailable = true;
    await act(async () => { expect(await result.current.load(value)).toBeNull(); });
    await expect(result.current.source(value, new AbortController().signal)).rejects.toMatchObject({ status: 412 });
  });
  it("wipes and blocks the source-derived editor when a focus check finds another signed-in owner", async () => {
    const { state } = api(), { result, changed } = setup(); await act(async () => { await result.current.load(original); });
    state.owner = child; act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(result.current.blocked).toBe(true);
    await expect(result.current.source(original, new AbortController().signal)).rejects.toMatchObject({ status: 412 });
    expect(await result.current.load(original)).toBeNull();
  });
  it.each(["metadata", "account"] as const)("does not open cached private answers after a denied %s read and requires an owned reload", async denied => {
    const { fetcher } = api(), usual = fetcher.getMockImplementation()!; let active = true;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => active && (denied === "metadata" ? url.includes("/family-profile-source?") : url.endsWith("/account"))
      ? { ok: false, status: denied === "metadata" ? 403 : 401, json: async () => ({ ok: false, error: "Sign in again" }) }
      : usual(url, init));
    const { result, changed } = setup(); await act(async () => { expect(await result.current.load(original)).toBeNull(); });
    expect(result.current.blocked).toBe(true); expect(result.current.canReload).toBe(true); expect(changed).toHaveBeenCalledOnce(); expect(result.current.notice).not.toMatch(/account changed/);
    active = false; await act(async () => { expect((await result.current.load(original))!.applicant!.firstName).toBe("CurrentCanary"); });
    expect(result.current.blocked).toBe(false);
  });
  it("closes a previously opened editor when the fresh account preflight denies access", async () => {
    const { fetcher } = api(), usual = fetcher.getMockImplementation()!, { result, changed } = setup(); let value!: SnapApplicationFields;
    await act(async () => { value = (await result.current.load(original))!; });
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/account") ? { ok: false, status: 401, json: async () => ({ ok: false }) } : usual(url, init));
    await act(async () => { await expect(result.current.source(value, new AbortController().signal)).rejects.toMatchObject({ status: 412 }); });
    expect(result.current.blocked).toBe(true); expect(result.current.canReload).toBe(true); expect(changed).toHaveBeenCalledOnce();
  });
  it("aborts a pending source read when the saved request version changes", async () => {
    let finish!: (value: unknown) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const { result, rerender } = setup(); let pending!: Promise<SnapApplicationFields | null>;
    act(() => { pending = result.current.load(original); }); rerender({ version: 8 });
    await act(async () => { finish({ ok: true, status: 200, json: async () => ({ fields: [] }) }); expect(await pending).toBeNull(); });
    expect(result.current.loading).toBe(false);
  });
});

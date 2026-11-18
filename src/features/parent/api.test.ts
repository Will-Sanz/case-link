import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedParentApi, ParentApiError, canCollectPecoApplication, canCollectPgwApplication, canCollectWaterApplication, type ParentAuthorizationWindow } from "./api";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE } from "@/lib/parent/peco-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_APPLICATION_SOURCE } from "@/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_APPLICATION_REFERENCE } from "@/lib/parent/water-application-fields";
import { WIC_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";

const current = () => ({ authorization: {
  issuedAt: PECO_APPLICATION_SOURCE.sourceCheckedAt, expiresAt: PECO_APPLICATION_SOURCE.verifiedUntil,
  pecoApplication: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: PECO_APPLICATION_SOURCE.verifiedUntil },
} });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(Date.parse(PECO_APPLICATION_SOURCE.sourceCheckedAt) + 1000)); });
afterEach(() => vi.useRealTimers());
describe("PECO private form availability", () => {
  it("requires PECO-specific approval and notice rather than another program's permission", () => {
    expect(canCollectPecoApplication(current())).toBe(true);
    for (const input of [null, {}, { authorization: { ...current().authorization, pecoApplication: undefined } },
      { authorization: { ...current().authorization, pecoApplication: { ...current().authorization.pecoApplication, collectionEnabled: false } } },
      { authorization: { ...current().authorization, pecoApplication: { ...current().authorization.pecoApplication, noticeVersion: WIC_APPLICATION_NOTICE_VERSION } } }] satisfies (ParentAuthorizationWindow | null)[])
      expect(canCollectPecoApplication(input)).toBe(false);
  });
  it("closes at the recorded purpose deadline and the checked source boundaries", () => {
    const input = current();
    const expired = { authorization: { ...input.authorization, pecoApplication: {
      ...input.authorization.pecoApplication, expiresAt: new Date(Date.now()).toISOString(),
    } } };
    expect(canCollectPecoApplication(expired)).toBe(false);
    for (const date of [Date.parse(PECO_APPLICATION_SOURCE.sourceCheckedAt) - 1, Date.parse(PECO_APPLICATION_SOURCE.verifiedUntil)]) {
      vi.setSystemTime(new Date(date));
      expect(canCollectPecoApplication(current())).toBe(false);
    }
  });
});

it.each([
  { key: "pgwApplication", canCollect: canCollectPgwApplication, notice: PGW_APPLICATION_NOTICE_VERSION, source: PGW_APPLICATION_SOURCE },
  { key: "waterApplication", canCollect: canCollectWaterApplication, notice: WATER_APPLICATION_NOTICE_VERSION, source: WATER_APPLICATION_REFERENCE },
] as const)("opens $key only under its own current notice and dated source", option => {
  const collection = { collectionEnabled: true, noticeVersion: option.notice, expiresAt: option.source.verifiedUntil };
  const input = { authorization: { issuedAt: option.source.sourceCheckedAt, expiresAt: option.source.verifiedUntil, [option.key]: collection } };
  vi.setSystemTime(new Date(Date.parse(option.source.sourceCheckedAt) + 1)); expect(option.canCollect(input)).toBe(true);
  expect(option.canCollect(current())).toBe(false);
  for (const changed of [{ ...collection, noticeVersion: PECO_APPLICATION_NOTICE_VERSION }, { ...collection, collectionEnabled: false }, { ...collection, expiresAt: new Date(Date.now()).toISOString() }])
    expect(option.canCollect({ authorization: { ...input.authorization, [option.key]: changed } })).toBe(false);
  for (const at of [Date.parse(option.source.sourceCheckedAt) - 1, Date.parse(option.source.verifiedUntil)]) {
    vi.setSystemTime(new Date(at)); expect(option.canCollect(input)).toBe(false);
  }
});

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each([0,-1,NaN,Infinity,120001])("rejects an invalid upload/read deadline %s before any network request",async limit=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(boundedParentApi("/requests/owned/documents",{},new AbortController().signal,new Date(Date.now()+120000).toISOString(),limit)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
it("preserves the default30second read bound and never extends an earlier purpose deadline",async()=>{
  vi.useFakeTimers();const fetcher=vi.fn().mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal("fetch",fetcher);
  const first=boundedParentApi("/requests/owned/documents",{},new AbortController().signal,new Date(Date.now()+120000).toISOString()).catch(error=>error);
  await vi.advanceTimersByTimeAsync(29999);expect((fetcher.mock.calls[0][1].signal as AbortSignal).aborted).toBe(false);await vi.advanceTimersByTimeAsync(1);expect(await first).toBeInstanceOf(ParentApiError);
  const second=boundedParentApi("/requests/owned/documents",{},new AbortController().signal,new Date(Date.now()+5000).toISOString(),120000).catch(error=>error);await vi.advanceTimersByTimeAsync(5000);expect(await second).toBeInstanceOf(ParentApiError);
});

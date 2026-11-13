import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canCollectPecoApplication, type ParentAuthorizationWindow } from "./api";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE } from "@/lib/parent/peco-application-fields";
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

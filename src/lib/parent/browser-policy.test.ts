import { describe, expect, it } from "vitest";
import {
  browserDeadline,
  compassResourceAllowed,
  publicBrowserAllowed,
  browserAuthoritySchema,
  browserControlSchema,
  browserSessionSchema,
  recaptchaFrameAllowed,
  COMPASS_FAMILY_SAFETY,
  COMPASS_CAPTCHA,
} from "./browser-policy";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureRequest,
  fixtureNow,
} from "./test-fixtures";
const authority = () =>
  browserAuthoritySchema.parse(
    fixtureRequest({
      intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ recipientIds: ["snap-pa"] }),
      ...{ mandate_revoked_at: null },
    }),
  );
describe("public COMPASS browser bounds", () => {
  it("requires an active new SNAP request and exact current research permission", () => {
    const value = authority();
    expect(publicBrowserAllowed(value, fixtureNow.getTime())).toBe(true);
    for (const changed of [
      { status: "paused" },
      { mandate_revoked_at: fixtureNow.toISOString() },
      { intake: { needs: ["snap_renewal"] } },
      { mandate: { ...value.mandate, recipientIds: ["peco-cap"] } },
      { mandate: { ...value.mandate, allowedActions: ["prepare"] as const } },
      { mandate: { ...value.mandate, expiresAt: fixtureNow.toISOString() } },
    ])
      expect(
        publicBrowserAllowed(
          { ...value, ...changed } as typeof value,
          fixtureNow.getTime(),
        ),
      ).toBe(false);
  });
  it("rejects arbitrary, private, non-TLS, credentialed and lookalike browser destinations", () => {
    expect(
      compassResourceAllowed(
        "https://www.compass.dhs.pa.gov/intake/#/getstarted",
      ),
    ).toBe(true);
    for (const url of [
      "http://www.compass.dhs.pa.gov",
      "https://www.compass.dhs.pa.gov.evil.test",
      "https://www.compass.dhs.pa.gov@evil.test",
      "https://me:secret@www.compass.dhs.pa.gov/",
      "https://127.0.0.1/",
      "http://169.254.169.254/",
      "file:///etc/passwd",
      "https://www.compass.dhs.pa.gov:444/",
    ])
      expect(compassResourceAllowed(url)).toBe(false);
  });
  it("permits only reviewed CAPTCHA resource paths and never as the main application page", () => {
    for (const url of [
      "https://www.google.com/recaptcha/api.js",
      "https://www.gstatic.com/recaptcha/releases/example.js",
    ]) {
      expect(compassResourceAllowed(url)).toBe(true);
      expect(compassResourceAllowed(url, true)).toBe(false);
    }
    expect(
      compassResourceAllowed("https://www.google.com/search?q=family"),
    ).toBe(false);
    expect(compassResourceAllowed("https://www.gstatic.com/other.js")).toBe(
      false,
    );
  });
  it("caps memory-only browser credentials to the earliest JWT, mandate, pilot or ten-minute boundary", () => {
    const now = fixtureNow.getTime();
    const jwt = (exp: number) =>
      `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
    const later = new Date(now + 3600000).toISOString();
    expect(
      browserDeadline(jwt((now + 3600000) / 1000), later, later, now),
    ).toBe(now + 600000);
    expect(browserDeadline(jwt((now + 20000) / 1000), later, later, now)).toBe(
      now + 20000,
    );
    expect(
      browserDeadline(
        jwt((now + 3600000) / 1000),
        new Date(now + 30000).toISOString(),
        later,
        now,
      ),
    ).toBe(now + 30000);
    expect(
      browserDeadline(
        jwt((now + 3600000) / 1000),
        later,
        new Date(now + 40000).toISOString(),
        now,
      ),
    ).toBe(now + 40000);
    expect(browserDeadline("bad-token", later, later, now)).toBe(0);
  });
  it("accepts only bounded public parent commands, never text, destinations or executable input", () => {
    const input = {
      sessionId: fixtureRequest().id,
      frameId: fixtureRequest().household_id,
      action: { type: "continue" },
    };
    for (const action of [
      { type: "continue" },
      { type: "refresh" },
      { type: "resume" },
      { type: "click", x: 0.5, y: 0 },
      { type: "key", key: "Shift+Tab" },
    ])
      expect(browserControlSchema.safeParse({ ...input, action }).success).toBe(
        true,
      );
    for (const change of [
      { action: { type: "click", x: -0.1, y: 0.5 } },
      { action: { type: "click", x: 0.5, y: 1.1 } },
      { action: { type: "click", x: Number.NaN, y: 0.5 } },
      { action: { type: "key", key: "A" } },
      { action: { type: "key", key: "Control+L" } },
      { action: { type: "type", text: "applicant details" } },
      { action: { type: "continue", url: "https://example.test" } },
      { frameId: "not-a-frame" },
      { cookies: [] },
    ])
      expect(
        browserControlSchema.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("requires an actual expiring handoff frame for parent control on either exact public verification route", () => {
    const session = {
      id: fixtureRequest().id,
      programId: "snap-pa",
      status: "needs_parent",
      currentUrl: COMPASS_FAMILY_SAFETY,
      title: "COMPASS",
      summary: "Public verification check",
      updatedAt: fixtureNow.toISOString(),
      canControl: true,
      frameUrl: `/api/parent/requests/${fixtureRequest().id}/browser/frame`,
      handoff: {
        kind: "continue",
        frameId: fixtureRequest().household_id,
        width: 1100,
        height: 720,
        expiresAt: new Date(fixtureNow.getTime() + 600000).toISOString(),
      },
    };
    expect(browserSessionSchema.safeParse(session).success).toBe(true);
    expect(
      browserSessionSchema.safeParse({
        ...session,
        currentUrl: COMPASS_CAPTCHA,
      }).success,
    ).toBe(true);
    for (const change of [
      { status: "running" },
      { handoff: null },
      { frameUrl: null },
      { canControl: false },
      {
        currentUrl:
          "https://www.compass.dhs.pa.gov/intake/#/applynow/household",
      },
      { handoff: { ...session.handoff, width: 10000 } },
    ])
      expect(
        browserSessionSchema.safeParse({ ...session, ...change }).success,
      ).toBe(false);
    expect(
      browserSessionSchema.safeParse({
        ...session,
        status: "blocked",
        canControl: false,
        frameUrl: null,
        handoff: undefined,
      }).success,
    ).toBe(true);
  });
  it("exposes only actual supported Google challenge URLs, excluding invisible badges and lookalikes", () => {
    for (const url of [
      "https://www.google.com/recaptcha/api2/anchor?size=normal",
      "https://www.google.com/recaptcha/api2/bframe?k=public-key",
    ])
      expect(recaptchaFrameAllowed(url)).toBe(true);
    for (const url of [
      "https://www.google.com/recaptcha/api2/anchor?size=invisible",
      "https://www.google.com/recaptcha/api2/anchor/extra",
      "https://www.google.com.evil.test/recaptcha/api2/bframe",
      "https://user:password@www.google.com/recaptcha/api2/bframe",
      "https://www.gstatic.com/recaptcha/api2/bframe",
      "about:blank",
    ])
      expect(recaptchaFrameAllowed(url)).toBe(false);
  });
});

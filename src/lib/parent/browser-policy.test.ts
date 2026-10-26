import { describe, expect, it } from "vitest";
import {
  browserDeadline,
  compassResourceAllowed,
  publicBrowserAllowed,
  browserAuthoritySchema,
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
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserContext } from "@playwright/test";
import { createApplicationBrowser } from "./browser-runner";
import {
  COMPASS_HOUSEHOLD_ENTRY,
  COMPASS_HOUSEHOLD_HEADING,
} from "./compass-household-entry";
import {
  browserAuthoritySchema,
  COMPASS_CAPTCHA,
  COMPASS_FAMILY_SAFETY,
  COMPASS_HOUSEHOLD_DIVIDER,
  COMPASS_INTRODUCTION_END,
  type BrowserControl,
} from "./browser-policy";
import {
  fixtureRequest,
  fixtureMandate,
  fixtureIntake,
  fixtureNow,
} from "./test-fixtures";

const id = fixtureRequest().id;
const token = "verified-token";
type Outcome =
  | "verification"
  | "household"
  | "household_changed"
  | "ending"
  | "ending_changed"
  | "divider_changed"
  | "challenge"
  | "captcha_challenge"
  | "captcha_challenge_late"
  | "unconfirmed";

/** A labeled replay of public DOM metadata; not live provider execution or a filing fixture. */
function harness(outcome: Outcome = "verification") {
  const prefix = "https://www.compass.dhs.pa.gov/intake/#/";
  const paths = [
    "getstarted",
    "applynow/gettingstarted",
    "applynow/gettingstarted/tutorial",
    "applynow/gettingstarted/importantinformation",
    "applynow/gettingstarted/submitreferral",
    "applynow/gettingstarted/WICpreapplication",
    "applynow/gettingstarted/gatepost",
    "applynow/gettingstarted/existingaccount",
    "applynow/gettingstarted/familysafety",
  ];
  let currentUrl = prefix + paths[0];
  let errorVisible = false;
  let challengeVisible = false;
  let nextEnabled = true;
  let topmost = true;
  let focused = true;
  let hydrating = false;
  let challengeBox = { x: 100, y: 100, width: 300, height: 200 };
  let challengeUrl =
    "https://www.google.com/recaptcha/api2/bframe?k=public-test-key";
  let beforeHandle: (() => void) | undefined;
  const listeners = new Map<string, (value: unknown) => void>();
  const mainFrame = {};
  const clicks = vi.fn<(url: string) => void>();
  const keyPress = vi.fn(async () => {});
  const forbiddenInput = vi.fn(() => {
    throw new Error("No applicant input is allowed");
  });
  function navigate(url: string) {
    currentUrl = url;
    listeners.get("framenavigated")?.(mainFrame);
  }
  const advance = async () => {
    const from = currentUrl;
    clicks(from);
    if (from === COMPASS_FAMILY_SAFETY) {
      if (outcome === "verification") errorVisible = true;
      else if (
        ["ending", "ending_changed", "divider_changed"].includes(outcome)
      )
        navigate(COMPASS_CAPTCHA);
      else if (outcome === "household" || outcome === "household_changed")
        navigate(COMPASS_HOUSEHOLD_ENTRY);
      else if (
        outcome === "challenge" ||
        outcome === "captcha_challenge" ||
        outcome === "captcha_challenge_late"
      ) {
        challengeVisible = outcome !== "captcha_challenge_late";
        if (outcome !== "challenge") navigate(COMPASS_CAPTCHA);
      } else navigate(prefix + "unsupported");
    } else if (from === COMPASS_INTRODUCTION_END)
      navigate(COMPASS_HOUSEHOLD_DIVIDER);
    else if (from === COMPASS_HOUSEHOLD_DIVIDER)
      navigate(COMPASS_HOUSEHOLD_ENTRY);
    else {
      const index = paths.findIndex((path) => prefix + path === from);
      navigate(prefix + paths[index + 1]);
    }
  };
  const keyTarget = { press: keyPress };
  const googleFrame = {
    url: () => challengeUrl,
    locator: () => ({ elementHandle: vi.fn(async () => keyTarget) }),
  };
  const challengeClick = vi.fn(async () => {});
  const challengeHandle = {
    contentFrame: async () => googleFrame,
    boundingBox: async () => challengeBox,
    evaluate: vi.fn(async (read: (...args: never[]) => unknown) =>
      read.length === 2 ? topmost : focused,
    ),
    click: challengeClick,
    focus: vi.fn(async () => {
      focused = true;
    }),
  };
  const challengeLocator = {
    getAttribute: async () => challengeUrl,
    elementHandle: async () => challengeHandle,
    isVisible: async () => challengeVisible,
  };
  const unknownFrame = {};
  const unknownLocator = {
    getAttribute: async () => "https://unreviewed.example.test/widget",
    elementHandle: async () => ({ contentFrame: async () => unknownFrame }),
  };
  const fieldMask = { kind: "masked-fields" };
  const screenshot = vi.fn(
    async (options: {
      mask: unknown[];
      maskColor: string;
    }): Promise<Buffer> => {
      if (!options.maskColor) throw new Error("unmasked frame");
      return Buffer.from(`actual-test-render:${currentUrl}`);
    },
  );
  const page = {
    on: vi.fn((event: string, callback: (value: unknown) => void) => {
      listeners.set(event, callback);
    }),
    mainFrame: () => mainFrame,
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async () => {}),
    url: () => currentUrl,
    viewportSize: vi.fn(() => ({ width: 1100, height: 720 })),
    getByText: vi.fn((text: string) => ({
      first: () => ({ waitFor: vi.fn(async () => {}) }),
      waitFor: vi.fn(async () => {
        if (
          (outcome === "ending_changed" &&
            currentUrl === COMPASS_INTRODUCTION_END) ||
          (outcome === "divider_changed" &&
            currentUrl === COMPASS_HOUSEHOLD_DIVIDER)
        )
          throw new Error("public metadata missing");
        hydrating = false;
      }),
      isVisible: vi.fn(async () =>
        text.startsWith("We were unable")
          ? errorVisible
          : !hydrating &&
            !(
              outcome === "ending_changed" &&
              currentUrl === COMPASS_INTRODUCTION_END
            ) &&
            !(
              outcome === "divider_changed" &&
              currentUrl === COMPASS_HOUSEHOLD_DIVIDER
            ),
      ),
    })),
    getByRole: vi.fn((role: string, options: { name: string }) => {
      const visible = async () =>
        role !== "heading" ||
        (!hydrating &&
          (options.name === COMPASS_HOUSEHOLD_HEADING
            ? outcome !== "household_changed"
            : true));
      const locator = {
        click: advance,
        waitFor: vi.fn(async () => {
          hydrating = false;
        }),
        isVisible: visible,
        isEnabled: async () => nextEnabled,
        elementHandle: vi.fn(async () => {
          const boundUrl = currentUrl;
          const handle = {
            isVisible: visible,
            isEnabled: async () => nextEnabled,
            getAttribute: async () => "nextButtonID",
            click: vi.fn(async () => {
              if (currentUrl !== boundUrl)
                throw new Error("detached public button");
              await advance();
            }),
          };
          beforeHandle?.();
          beforeHandle = undefined;
          return handle;
        }),
        last: () => locator,
      };
      return locator;
    }),
    locator: vi.fn((selector: string) => {
      if (selector === "iframe")
        return { all: async () => [challengeLocator, unknownLocator] };
      if (selector === 'main input:not([type="hidden"])')
        return {
          evaluateAll: vi.fn(async () =>
            outcome === "household_changed"
              ? []
              : [
                  "firstName",
                  "lastName",
                  "dob-datepicker-date",
                  "gender_male",
                  "gender_female",
                ].map((field) => ({
                  id: field,
                  type: field.startsWith("gender_") ? "radio" : "text",
                  required: true,
                })),
          ),
        };
      if (selector.startsWith("label")) return { click: vi.fn(async () => {}) };
      return fieldMask;
    }),
    waitForURL: vi.fn(async (expected: string | ((url: URL) => boolean)) => {
      if (typeof expected === "string") {
        if (currentUrl !== expected) throw new Error("unexpected public route");
      } else {
        if (!expected(new URL(currentUrl)))
          throw new Error("bounded navigation timeout");
      }
    }),
    waitForFunction: vi.fn(async () => {
      if (outcome === "captcha_challenge_late") challengeVisible = true;
      else navigate(COMPASS_INTRODUCTION_END);
    }),
    screenshot,
    fill: forbiddenInput,
    inputValue: forbiddenInput,
  };
  const context = {
    route: vi.fn(async () => {}),
    routeWebSocket: vi.fn(async () => {}),
    on: vi.fn(),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const authority = browserAuthoritySchema.parse({
    ...fixtureRequest({
      intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ recipientIds: ["snap-pa"] }),
    }),
    mandate_revoked_at: null,
  });
  const grant = {
    ownerId: "owner",
    authority,
    expiresAt: fixtureNow.getTime() + 600000,
  };
  const authorize = vi.fn(async () => grant);
  const runner = createApplicationBrowser({
    authorize,
    context: async () => context as unknown as BrowserContext,
  });
  async function state() {
    return (await runner.read(token, id, "GET")).json();
  }
  async function start() {
    await runner.read(token, id, "POST");
    await vi.waitFor(async () =>
      expect((await state()).session?.status).toBe("needs_parent"),
    );
    return state();
  }
  async function input(
    action: BrowserControl["action"] = { type: "continue" },
  ) {
    const value = await state();
    const session = value.session;
    await runner.read(token, id, "GET", true, session.handoff.frameId);
    return { sessionId: session.id, frameId: session.handoff.frameId, action };
  }
  return {
    runner,
    authorize,
    grant,
    context,
    screenshot,
    clicks,
    page,
    challengeLocator,
    unknownLocator,
    fieldMask,
    challengeClick,
    keyPress,
    forbiddenInput,
    state,
    start,
    input,
    navigate,
    setNextEnabled: (value: boolean) => {
      nextEnabled = value;
    },
    setTopmost: (value: boolean) => {
      topmost = value;
    },
    setFocused: (value: boolean) => {
      focused = value;
    },
    setHydrating: (value: boolean) => {
      hydrating = value;
    },
    moveChallenge: () => {
      challengeBox = { ...challengeBox, x: challengeBox.x + 20 };
    },
    setChallengeUrl: (value: string) => {
      challengeUrl = value;
    },
    beforeHandle: (callback: () => void) => {
      beforeHandle = callback;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixtureNow);
});
afterEach(() => {
  vi.useRealTimers();
});

it("pauses one actual context before Family Safety Next and provides only a masked, expiring preview handoff", async () => {
  const h = harness();
  const value = await h.start();
  expect(h.context.newPage).toHaveBeenCalledTimes(1);
  expect(h.context.close).not.toHaveBeenCalled();
  expect(
    h.clicks.mock.calls.filter(([url]) => url === COMPASS_FAMILY_SAFETY),
  ).toHaveLength(0);
  expect(value.session.canControl).toBe(true);
  expect(value.session.handoff).toMatchObject({
    width: 1100,
    height: 720,
    expiresAt: new Date(h.grant.expiresAt).toISOString(),
  });
  expect(value.session.summary).toContain("This preview pauses");
  expect(value.session.summary).toContain(
    "does not establish that every applicant",
  );
  expect(h.screenshot).toHaveBeenCalledTimes(9);
  expect(
    h.screenshot.mock.calls.every(
      ([options]) => (options as { maskColor: string }).maskColor === "#dcd8ed",
    ),
  ).toBe(true);
  await h.runner.close();
});

it("requires the exact served frame before control, rejects stale reads, and consumes each accepted nonce once", async () => {
  const h = harness("household");
  const { session } = await h.start();
  const command = {
    sessionId: session.id,
    frameId: session.handoff.frameId,
    action: { type: "continue" },
  };
  await expect(h.runner.control(token, id, command)).rejects.toThrow(
    "stale_frame",
  );
  await expect(h.runner.read(token, id, "GET", true)).rejects.toThrow(
    "stale_frame",
  );
  await expect(
    h.runner.read(token, id, "GET", true, fixtureRequest().id),
  ).rejects.toThrow("stale_frame");
  const frame = await h.runner.read(token, id, "GET", true, command.frameId);
  expect(frame.headers.get("cache-control")).toBe("private, no-store");
  expect(await frame.text()).toContain(COMPASS_FAMILY_SAFETY);
  await h.runner.control(token, id, command);
  await expect(h.runner.control(token, id, command)).rejects.toThrow(
    "stale_frame",
  );
  expect(
    h.clicks.mock.calls.filter(([url]) => url === COMPASS_FAMILY_SAFETY),
  ).toHaveLength(1);
  await h.runner.close();
});

it.each(["household", "ending"] as const)(
  "recognizes same-session %s resumption and stops before any protected screenshot or applicant input",
  async (outcome) => {
    const h = harness(outcome);
    await h.start();
    await h.runner.control(token, id, await h.input());
    const value = await h.state();
    expect(value.session.status).toBe("completed");
    expect(value.session.summary).toContain("same browser session");
    expect(value.session.summary).toContain("no application was submitted");
    expect(value.session.canControl).toBe(false);
    expect(value.session.handoff).toBeNull();
    expect(value.session.frameUrl).toBeNull();
    expect(h.screenshot).toHaveBeenCalledTimes(9);
    expect(h.context.close).toHaveBeenCalledTimes(1);
    expect(h.forbiddenInput).not.toHaveBeenCalled();
    if (outcome === "ending") {
      expect(
        h.clicks.mock.calls.filter(
          ([url]) =>
            url === COMPASS_INTRODUCTION_END ||
            url === COMPASS_HOUSEHOLD_DIVIDER,
        ),
      ).toHaveLength(2);
    }
    expect((await h.runner.read(token, id, "GET", true)).status).toBe(404);
    await h.runner.close();
  },
);

it.each([
  "household_changed",
  "ending_changed",
  "divider_changed",
  "unconfirmed",
] as const)(
  "fails closed on changed or unknown %s metadata without applicant input",
  async (outcome) => {
    const h = harness(outcome);
    await h.start();
    await h.runner.control(token, id, await h.input()).catch(() => {});
    const value = await h.state();
    expect(value.session.status).toBe("blocked");
    expect(value.session.canControl).toBe(false);
    expect(value.session.frameUrl).toBeNull();
    expect(h.screenshot).toHaveBeenCalledTimes(9);
    expect(h.forbiddenInput).not.toHaveBeenCalled();
    await h.runner.close();
  },
);

it("keeps a provider verification error a service block and never automatically retries it", async () => {
  const h = harness();
  await h.start();
  await h.runner.control(token, id, await h.input());
  const value = await h.state();
  expect(value.session.status).toBe("blocked");
  expect(value.session.summary).toContain(
    "CaseLink must resolve the connection",
  );
  expect(value.session.canControl).toBe(false);
  await h.runner.sweep();
  expect(
    h.clicks.mock.calls.filter(([url]) => url === COMPASS_FAMILY_SAFETY),
  ).toHaveLength(1);
  await h.runner.close();
});

it("automatically resumes a verified same-page transition during sweep without an 'I finished' click", async () => {
  const h = harness("ending");
  await h.start();
  h.navigate(COMPASS_INTRODUCTION_END);
  await h.runner.sweep();
  expect((await h.state()).session.status).toBe("completed");
  expect(
    h.clicks.mock.calls.filter(
      ([url]) =>
        url === COMPASS_INTRODUCTION_END || url === COMPASS_HOUSEHOLD_DIVIDER,
    ),
  ).toHaveLength(2);
  expect(h.screenshot).toHaveBeenCalledTimes(9);
  await h.runner.close();
});

it.each(["challenge", "captcha_challenge", "captcha_challenge_late"] as const)(
  "allows genuine bounded parent iframe control on the exact %s public route",
  async (outcome) => {
    const h = harness(outcome);
    await h.start();
    await h.runner.control(token, id, await h.input());
    const challenge = await h.state();
    expect(challenge.session.status).toBe("needs_parent");
    expect(challenge.session.currentUrl).toBe(
      outcome === "challenge" ? COMPASS_FAMILY_SAFETY : COMPASS_CAPTCHA,
    );
    const masks = (h.screenshot.mock.calls.at(-1)?.[0] as { mask: unknown[] })
      .mask;
    expect(masks).toContain(h.fieldMask);
    expect(masks).toContain(h.unknownLocator);
    expect(masks).not.toContain(h.challengeLocator);
    await h.runner.control(
      token,
      id,
      await h.input({ type: "click", x: 0.2, y: 0.2 }),
    );
    expect(h.challengeClick).toHaveBeenCalledWith({
      position: { x: 120, y: 44 },
      timeout: 2000,
    });
    await h.runner.control(
      token,
      id,
      await h.input({ type: "key", key: "Tab" }),
    );
    expect(h.keyPress).toHaveBeenCalledWith("Tab", { timeout: 2000 });
    h.navigate(COMPASS_HOUSEHOLD_ENTRY);
    await h.runner.sweep();
    expect((await h.state()).session.status).toBe("completed");
    await h.runner.close();
  },
);

it("rejects non-frame clicks, overlays and keys focused outside the approved frame without consuming the valid nonce", async () => {
  const h = harness("challenge");
  await h.start();
  await h.runner.control(token, id, await h.input());
  const original = await h.input({ type: "click", x: 0.9, y: 0.9 });
  await expect(h.runner.control(token, id, original)).rejects.toThrow(
    "control_target",
  );
  h.setTopmost(false);
  await expect(
    h.runner.control(token, id, {
      ...original,
      action: { type: "click", x: 0.2, y: 0.2 },
    }),
  ).rejects.toThrow("control_target");
  h.setFocused(false);
  await expect(
    h.runner.control(token, id, {
      ...original,
      action: { type: "key", key: "Enter" },
    }),
  ).rejects.toThrow("control_target");
  const unchanged = (await h.state()).session;
  expect(unchanged.handoff.frameId).toBe(original.frameId);
  expect(unchanged.handoff.expiresAt).toBe(
    new Date(h.grant.expiresAt).toISOString(),
  );
  expect(h.challengeClick).not.toHaveBeenCalled();
  expect(h.keyPress).not.toHaveBeenCalled();
  await h.runner.close();
});

it("lets a keyboard-only parent enter the actual verified challenge frame with Tab", async () => {
  const h = harness("challenge");
  await h.start();
  await h.runner.control(token, id, await h.input());
  h.setFocused(false);
  await h.runner.control(token, id, await h.input({ type: "key", key: "Tab" }));
  expect(h.keyPress).toHaveBeenCalledWith("Tab", { timeout: 2000 });
  expect(h.challengeClick).not.toHaveBeenCalled();
  await h.runner.close();
});

it("waits for public SPA metadata before following the reviewed ending and divider controls", async () => {
  const h = harness("ending");
  await h.start();
  h.setHydrating(true);
  await h.runner.control(token, id, await h.input());
  expect((await h.state()).session.status).toBe("completed");
  expect(h.screenshot).toHaveBeenCalledTimes(9);
  await h.runner.close();
});

it("rejects a challenge that reflows while current authorization is being checked", async () => {
  const h = harness("challenge");
  await h.start();
  await h.runner.control(token, id, await h.input());
  const command = await h.input({ type: "click", x: 0.2, y: 0.2 });
  const ordinary = h.authorize.getMockImplementation()!;
  let checks = 0;
  h.authorize.mockImplementation(async () => {
    checks++;
    if (checks === 5) h.moveChallenge();
    return ordinary();
  });
  await expect(h.runner.control(token, id, command)).rejects.toThrow(
    "control_target",
  );
  expect(h.challengeClick).not.toHaveBeenCalled();
  expect((await h.state()).session.handoff.frameId).toBe(command.frameId);
  await h.runner.close();
});

it("Stop clears the context before a newly reached public ending can resume", async () => {
  const h = harness("ending");
  await h.start();
  h.navigate(COMPASS_INTRODUCTION_END);
  const stopped = await (await h.runner.read(token, id, "DELETE")).json();
  expect(stopped.session.status).toBe("closed");
  expect(
    h.clicks.mock.calls.filter(
      ([url]) =>
        url === COMPASS_INTRODUCTION_END || url === COMPASS_HOUSEHOLD_DIVIDER,
    ),
  ).toHaveLength(0);
  expect(h.context.close).toHaveBeenCalledTimes(1);
  await h.runner.close();
});

it("masks and refuses an invisible or foreign verification iframe", async () => {
  const h = harness("challenge");
  h.setChallengeUrl(
    "https://www.google.com/recaptcha/api2/anchor?size=invisible",
  );
  await h.start();
  await h.runner.control(token, id, await h.input());
  expect((await h.state()).session.status).toBe("blocked");
  expect((h.screenshot.mock.calls[8][0] as { mask: unknown[] }).mask).toContain(
    h.challengeLocator,
  );
  expect(h.challengeClick).not.toHaveBeenCalled();
  await h.runner.close();
});

it("rejects foreign owners, wrong sessions, arbitrary input and concurrent replay without browser effects", async () => {
  const h = harness();
  await h.start();
  const command = await h.input({ type: "refresh" });
  h.authorize.mockResolvedValueOnce({ ...h.grant, ownerId: "another-owner" });
  await expect(h.runner.control("foreign-token", id, command)).rejects.toThrow(
    "not_owned",
  );
  await expect(
    h.runner.control(token, id, { ...command, sessionId: fixtureRequest().id }),
  ).rejects.toThrow("stale_frame");
  await expect(
    h.runner.control(token, id, {
      ...command,
      action: { type: "type", text: "sensitive" },
    }),
  ).rejects.toThrow();
  const results = await Promise.allSettled([
    h.runner.control(token, id, command),
    h.runner.control(token, id, command),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(h.screenshot).toHaveBeenCalledTimes(10);
  expect((await h.state()).session.handoff.frameId).not.toBe(command.frameId);
  expect(h.forbiddenInput).not.toHaveBeenCalled();
  await h.runner.close();
});

it("rejects navigation during target inspection before it can click a different page's Next", async () => {
  const h = harness("household");
  await h.start();
  const command = await h.input();
  h.beforeHandle(() => h.navigate(COMPASS_HOUSEHOLD_ENTRY));
  await expect(h.runner.control(token, id, command)).rejects.toThrow(
    "page_changed",
  );
  expect(
    h.clicks.mock.calls.filter(
      ([url]) =>
        url === COMPASS_FAMILY_SAFETY || url === COMPASS_HOUSEHOLD_ENTRY,
    ),
  ).toHaveLength(0);
  expect(h.screenshot).toHaveBeenCalledTimes(9);
  expect((await h.state()).session.canControl).toBe(false);
  await h.runner.close();
});

it.each(["paused", "cancelled", "revoked", "expired"] as const)(
  "erases the same-session handoff when authority becomes %s",
  async (reason) => {
    const h = harness();
    await h.start();
    const command = await h.input();
    if (reason === "expired") vi.setSystemTime(new Date(h.grant.expiresAt + 1));
    else if (reason === "revoked")
      h.authorize.mockRejectedValue(new Error("revoked"));
    else h.grant.authority.status = reason;
    await h.runner.sweep();
    expect(h.context.close).toHaveBeenCalledTimes(1);
    await expect(h.runner.control(token, id, command)).rejects.toThrow();
    if (reason !== "revoked") {
      const value = await h.state();
      expect(value.session.frameUrl).toBeNull();
      expect(value.session.handoff).toBeNull();
      expect(value.session.canControl).toBe(false);
    }
    await h.runner.close();
  },
);

it("bounds accepted commands without changing the session deadline, and invalid requests do not refresh it", async () => {
  const h = harness();
  await h.start();
  for (let index = 0; index < 12; index++)
    await h.runner.control(token, id, await h.input({ type: "refresh" }));
  const command = await h.input({ type: "refresh" });
  await expect(h.runner.control(token, id, command)).rejects.toThrow(
    "control_rate",
  );
  expect((await h.state()).session.handoff.frameId).toBe(command.frameId);
  expect((await h.state()).session.handoff.expiresAt).toBe(
    new Date(h.grant.expiresAt).toISOString(),
  );
  await h.runner.close();
});

it("ends an exhausted total command allowance instead of advertising permanently unusable controls", async () => {
  const h = harness();
  await h.start();
  let result;
  for (let index = 0; index < 120; index++) {
    if (index % 12 === 0) vi.setSystemTime(new Date(Date.now() + 11000));
    result = await (
      await h.runner.control(token, id, await h.input({ type: "refresh" }))
    ).json();
  }
  expect(result.session.status).toBe("blocked");
  expect(result.session.summary).toContain("interaction limit");
  expect(result.session.canControl).toBe(false);
  expect(result.session.handoff).toBeNull();
  expect(h.context.close).toHaveBeenCalledTimes(1);
  await h.runner.close();
});

it("cannot restore a frame after Stop races with screenshot capture", async () => {
  const h = harness();
  let finish: (value: Buffer) => void = () => {};
  h.screenshot.mockImplementationOnce(
    () =>
      new Promise<Buffer>((resolve) => {
        finish = resolve;
      }),
  );
  await h.runner.read(token, id, "POST");
  await vi.waitFor(() => expect(h.screenshot).toHaveBeenCalled());
  await h.runner.read(token, id, "DELETE");
  finish(Buffer.from("late frame"));
  await vi.waitFor(() => expect(h.context.close).toHaveBeenCalled());
  const value = await h.state();
  expect(value.session.status).toBe("closed");
  expect(value.session.frameUrl).toBeNull();
  expect(value.session.handoff).toBeNull();
  expect((await h.runner.read(token, id, "GET", true)).status).toBe(404);
  await h.runner.close();
});

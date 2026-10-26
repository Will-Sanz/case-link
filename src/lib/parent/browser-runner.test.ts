import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserContext } from "@playwright/test";
import { createApplicationBrowser } from "./browser-runner";
import { browserAuthoritySchema } from "./browser-policy";
import {
  fixtureRequest,
  fixtureMandate,
  fixtureIntake,
  fixtureNow,
} from "./test-fixtures";
const id = fixtureRequest().id;
function harness(
  outcome:
    | "verification"
    | "household"
    | "household_changed"
    | "unconfirmed" = "verification",
) {
  let path = "getstarted";
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
  const click = vi.fn(async () => {
    const index = paths.indexOf(path);
    path =
      paths[index + 1] ??
      (outcome.startsWith("household")
        ? "applynow/household/householdDetails"
        : paths.at(-1)!);
  });
  const locator = {
    click: vi.fn(async () => {}),
    isVisible: vi.fn(async () => outcome !== "unconfirmed"),
    first: () => ({ waitFor: vi.fn(async () => {}) }),
    evaluateAll: vi.fn(async () =>
      outcome === "household_changed"
        ? []
        : [
            "firstName",
            "lastName",
            "dob-datepicker-date",
            "gender_male",
            "gender_female",
          ].map((id) => ({
            id,
            type: id.startsWith("gender_") ? "radio" : "text",
            required: true,
          })),
    ),
  };
  const screenshot = vi.fn(
    async (options: { maskColor?: string }): Promise<Buffer> => {
      if (!options.maskColor) throw new Error("unmasked frame");
      return Buffer.from("actual-test-render");
    },
  );
  const page = {
    on: vi.fn(),
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async () => {}),
    url: () => `https://www.compass.dhs.pa.gov/intake/#/${path}`,
    getByText: vi.fn(() => locator),
    locator: vi.fn(() => locator),
    getByRole: vi.fn(() => ({
      click,
      isVisible: locator.isVisible,
      last: () => ({ click }),
    })),
    waitForURL: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    screenshot,
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
  return { runner, authorize, grant, context, screenshot, click };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixtureNow);
});
afterEach(() => vi.useRealTimers());
it("renders masked public pages, closes on an automation block and does not imply a resumable personal step", async () => {
  const { runner, screenshot, authorize, context } = harness();
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
  expect(screenshot).toHaveBeenCalledTimes(9);
  const result = await (await runner.read("verified-token", id, "GET")).json();
  expect(result.session.status).toBe("blocked");
  expect(result.session.summary).toContain(
    "No household fields were entered or submitted",
  );
  expect(result.session.canControl).toBe(false);
  expect(result.session.summary).toContain(
    "cannot resume that application through this viewer yet",
  );
  expect(result.session.frameUrl).toBeNull();
  expect(
    screenshot.mock.calls.every(
      ([options]) => options?.maskColor === "#dcd8ed",
    ),
  ).toBe(true);
  expect(authorize.mock.calls.length).toBeGreaterThan(20);
  expect((await runner.read("verified-token", id, "GET", true)).status).toBe(
    404,
  );
  const stopped = await (
    await runner.read("verified-token", id, "DELETE")
  ).json();
  expect(stopped.session.status).toBe("closed");
  expect(stopped.session.frameUrl).toBeNull();
  expect(context.close).toHaveBeenCalled();
  expect((await runner.read("verified-token", id, "GET", true)).status).toBe(
    404,
  );
  await runner.close();
});
it("closes before showing a protected household form", async () => {
  const { runner, screenshot, context } = harness("household");
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
  expect(screenshot).toHaveBeenCalledTimes(9);
  const value = await (await runner.read("verified-token", id, "GET")).json();
  expect(value.session.status).toBe("blocked");
  expect(value.session.frameUrl).toBeNull();
  expect(value.session.summary).toContain("protected application connection");
  await runner.close();
});
it("does not confirm household entry when the exact URL has unknown fields", async () => {
  const { runner, screenshot, context } = harness("household_changed");
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
  const value = await (await runner.read("verified-token", id, "GET")).json();
  expect(value.session.summary).toContain(
    "expected fields could not be confirmed",
  );
  expect(value.session.status).toBe("blocked");
  expect(value.session.frameUrl).toBeNull();
  expect(screenshot).toHaveBeenCalledTimes(9);
  await runner.close();
});
it("stops ongoing work and erases frames when authorization is revoked", async () => {
  const { runner, authorize, context } = harness();
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.newPage).toHaveBeenCalled());
  authorize.mockRejectedValue(new Error("revoked"));
  await runner.sweep();
  expect(context.close).toHaveBeenCalled();
  await expect(runner.read("verified-token", id, "GET", true)).rejects.toThrow(
    "revoked",
  );
  await runner.close();
});
it("does not expose another owner's browser and expires contexts without page polling", async () => {
  const { runner, authorize, grant, context } = harness();
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.newPage).toHaveBeenCalled());
  authorize.mockResolvedValueOnce({ ...grant, ownerId: "another-owner" });
  await expect(runner.read("other-token", id, "GET")).rejects.toThrow(
    "browser_not_owned",
  );
  vi.setSystemTime(new Date(grant.expiresAt + 1));
  await runner.sweep();
  expect(context.close).toHaveBeenCalled();
  await runner.close();
});

it("does not label an unconfirmed provider result as a personal verification step", async () => {
  const { runner, context, screenshot } = harness("unconfirmed");
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
  const value = await (await runner.read("verified-token", id, "GET")).json();
  expect(value.session.status).toBe("blocked");
  expect(value.session.summary).toContain("could not be confirmed");
  expect(screenshot).toHaveBeenCalledTimes(9);
  await runner.close();
});
it("cannot restore a frame after Stop races with screenshot capture", async () => {
  const { runner, screenshot, context } = harness();
  let finish: (value: Buffer) => void = () => {};
  screenshot.mockImplementationOnce(
    () =>
      new Promise<Buffer>((resolve) => {
        finish = resolve;
      }),
  );
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(screenshot).toHaveBeenCalled());
  await runner.read("verified-token", id, "DELETE");
  finish(Buffer.from("late screenshot"));
  await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
  const value = await (await runner.read("verified-token", id, "GET")).json();
  expect(value.session.status).toBe("closed");
  expect(value.session.frameUrl).toBeNull();
  expect((await runner.read("verified-token", id, "GET", true)).status).toBe(
    404,
  );
  await runner.close();
});

it("serves an actual masked frame while a public page check is still running", async () => {
  const { runner, screenshot } = harness();
  let finish: (value: Buffer) => void = () => {};
  screenshot.mockImplementationOnce(async () =>
    Buffer.from("first actual frame"),
  );
  screenshot.mockImplementationOnce(
    () =>
      new Promise<Buffer>((resolve) => {
        finish = resolve;
      }),
  );
  await runner.read("verified-token", id, "POST");
  await vi.waitFor(() => expect(screenshot).toHaveBeenCalledTimes(2));
  const frame = await runner.read("verified-token", id, "GET", true);
  expect(await frame.text()).toBe("first actual frame");
  expect(frame.headers.get("cache-control")).toContain("no-store");
  await runner.read("verified-token", id, "DELETE");
  finish(Buffer.from("late frame"));
  await runner.close();
});

import { randomUUID } from "node:crypto";
import {
  errors,
  type BrowserContext,
  type ElementHandle,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  COMPASS_HOUSEHOLD_ENTRY,
  COMPASS_HOUSEHOLD_HEADING,
  compassHouseholdEntryObserved,
} from "./compass-household-entry";
import {
  COMPASS_ENTRY,
  COMPASS_FAMILY_SAFETY,
  COMPASS_CAPTCHA,
  COMPASS_INTRODUCTION_END,
  COMPASS_HOUSEHOLD_DIVIDER,
  browserControlSchema,
  compassResourceAllowed,
  publicBrowserAllowed,
  recaptchaFrameAllowed,
  type ApplicationBrowserSession,
  type BrowserAuthority,
} from "./browser-policy";

export type BrowserGrant = {
  ownerId: string;
  authority: BrowserAuthority;
  expiresAt: number;
};
type Job = {
  grant: BrowserGrant;
  token: string;
  session: ApplicationBrowserSession;
  context: BrowserContext | null;
  page: Page | null;
  frame: Uint8Array | null;
  deliveredFrameId: string | null;
  parentPhase: boolean;
  controlling: boolean;
  continued: boolean;
  controls: number[];
  challengeBoxes: { frame: Frame; box: Box }[];
};
type Box = { x: number; y: number; width: number; height: number };
const sameBox = (left: Box, right: Box | null) =>
  right &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;
const compassCaptchaHeading =
  "Since you're applying without an account, we need to confirm that you're a human.";
type Ports = {
  authorize(token: string, requestId: string): Promise<BrowserGrant>;
  context(): Promise<BrowserContext>;
  now?: () => number;
};

/** A public introduction and bounded parent verification surface, never an applicant-data submitter. */
export function createApplicationBrowser(ports: Ports) {
  // shortcut: one localhost viewer holds at most four ephemeral sessions; use a dedicated broker before a hosted release.
  const jobs = new Map<string, Job>();
  const now = ports.now ?? Date.now;
  const closed = (job: Job) =>
    ["closed", "failed", "blocked", "completed"].includes(job.session.status);
  function update(job: Job, values: Partial<ApplicationBrowserSession>) {
    Object.assign(job.session, values, {
      updatedAt: new Date(now()).toISOString(),
    });
  }
  async function close(
    job: Job,
    summary: string,
    status: "closed" | "blocked" | "completed" = "closed",
  ) {
    update(job, {
      status,
      summary,
      frameUrl: null,
      handoff: null,
      canControl: false,
    });
    job.frame = null;
    job.deliveredFrameId = null;
    job.challengeBoxes = [];
    job.token = "";
    const context = job.context;
    job.context = null;
    job.page = null;
    await context?.close().catch(() => undefined);
  }
  async function check(job: Job) {
    if (closed(job) || job.grant.expiresAt <= now())
      throw new Error("browser_grant_expired");
    const current = await ports.authorize(job.token, job.grant.authority.id);
    if (
      closed(job) ||
      job.grant.expiresAt <= now() ||
      current.ownerId !== job.grant.ownerId ||
      current.authority.version !== job.grant.authority.version ||
      JSON.stringify(current.authority.mandate) !==
        JSON.stringify(job.grant.authority.mandate) ||
      !publicBrowserAllowed(current.authority, now())
    )
      throw new Error("browser_grant_changed");
  }
  function clearFrame(job: Job) {
    job.frame = null;
    job.deliveredFrameId = null;
    job.challengeBoxes = [];
    update(job, { frameUrl: null, handoff: null, canControl: false });
  }
  async function challengeFrames(page: Page) {
    const frames: {
      locator: Locator;
      handle: ElementHandle;
      frame: Frame;
      box: Box;
    }[] = [];
    const viewport = page.viewportSize();
    if (!viewport) return frames;
    for (const locator of await page.locator("iframe").all()) {
      const src = await locator.getAttribute("src");
      if (!src || !recaptchaFrameAllowed(src)) continue;
      const handle = await locator.elementHandle();
      const frame = await handle?.contentFrame();
      const box = await handle?.boundingBox();
      if (
        handle &&
        frame &&
        recaptchaFrameAllowed(frame.url()) &&
        box &&
        box.width >= 40 &&
        box.height >= 40 &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height &&
        (await locator.isVisible())
      )
        frames.push({ locator, handle, frame, box });
    }
    return frames;
  }
  async function capture(
    job: Job,
    page: Page,
    kind?: "continue" | "challenge",
  ) {
    const interactive = Boolean(kind);
    await check(job);
    const url = new URL(page.url());
    const path = url.hash.replace(/^#\//, "");
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
      "applynow/gettingstarted/captcha",
    ];
    if (!compassResourceAllowed(page.url(), true) || !paths.includes(path))
      throw new Error("browser_protected_boundary");
    if (
      interactive &&
      ![COMPASS_FAMILY_SAFETY, COMPASS_CAPTCHA].includes(page.url())
    )
      throw new Error("browser_protected_boundary");
    const allowed = interactive ? await challengeFrames(page) : [];
    const masked = [page.locator("input, textarea, select, [contenteditable]")];
    for (const locator of await page.locator("iframe").all()) {
      const handle = await locator.elementHandle();
      const frame = await handle?.contentFrame();
      if (!frame || !allowed.some((candidate) => candidate.frame === frame))
        masked.push(locator);
    }
    const frame = await page.screenshot({
      type: "jpeg",
      quality: 65,
      animations: "disabled",
      mask: masked,
      maskColor: "#dcd8ed",
    });
    await check(job);
    if (page.url() !== url.href) throw new Error("browser_page_changed");
    const viewport = page.viewportSize();
    if (
      interactive &&
      (!viewport || viewport.width > 4096 || viewport.height > 4096)
    )
      throw new Error("browser_invalid_viewport");
    const handoff = job.session.handoff;
    if (
      interactive &&
      viewport &&
      job.frame &&
      handoff &&
      handoff.kind === kind &&
      job.session.currentUrl === url.href &&
      handoff.width === viewport.width &&
      handoff.height === viewport.height &&
      Buffer.from(job.frame).equals(frame) &&
      job.challengeBoxes.length === allowed.length &&
      job.challengeBoxes.every(
        (displayed, index) =>
          displayed.frame === allowed[index].frame &&
          sameBox(displayed.box, allowed[index].box),
      )
    )
      return;
    job.frame = frame;
    job.deliveredFrameId = null;
    job.challengeBoxes = allowed.map(({ frame, box }) => ({ frame, box }));
    update(job, {
      currentUrl: `https://www.compass.dhs.pa.gov/intake/#/${path}`,
      frameUrl: `/api/parent/requests/${job.grant.authority.id}/browser/frame`,
      ...(interactive && viewport
        ? {
            status: "needs_parent",
            canControl: true,
            handoff: {
              frameId: randomUUID(),
              kind: kind!,
              width: viewport.width,
              height: viewport.height,
              expiresAt: new Date(job.grant.expiresAt).toISOString(),
            },
          }
        : {}),
    });
  }

  async function observe(job: Job): Promise<boolean> {
    for (let step = 0; step < 5; step++) {
      await check(job);
      const page = job.page;
      if (!page) throw new Error("browser_page_unavailable");
      const url = page.url();
      if (url === COMPASS_FAMILY_SAFETY) {
        if (
          await page
            .getByText(
              "We were unable to verify your information at this time. You can try again.",
              { exact: true },
            )
            .isVisible()
        ) {
          await close(
            job,
            "COMPASS blocked this browser connection. No household information was entered or submitted. CaseLink must resolve the connection before this application can continue here.",
            "blocked",
          );
          return false;
        }
        await check(job);
        if (page.url() === url) return true;
        continue;
      }
      if (url === COMPASS_CAPTCHA) {
        const component = page.locator("compass-ui-getting-started-captcha");
        const next = component.getByRole("button", {
          name: "Next Button",
          exact: true,
        });
        if ((await next.isVisible()) && (await next.isEnabled())) {
          const title = component.getByRole("heading", {
            name: compassCaptchaHeading,
            exact: true,
          });
          const button = await next.elementHandle({ timeout: 3000 });
          if (!button) throw new Error("browser_public_step_changed");
          clearFrame(job);
          update(job, {
            status: "running",
            summary:
              "COMPASS enabled its normal Next step. CaseLink is continuing in this same session without entering household information.",
          });
          await check(job);
          if (
            page.url() !== url ||
            !(await title.isVisible()) ||
            !(await button.isVisible()) ||
            !(await button.isEnabled()) ||
            (await button.getAttribute("id")) !== "nextButtonID"
          )
            throw new Error("browser_public_step_changed");
          await check(job);
          if (page.url() !== url) throw new Error("browser_page_changed");
          await button.click({ timeout: 2000 });
          await check(job);
          await page.waitForURL((value) => value.href !== url, {
            timeout: 5000,
          });
          continue;
        }
        if ((await challengeFrames(page)).length > 0) return true;
        clearFrame(job);
        update(job, {
          status: "running",
          currentUrl: COMPASS_CAPTCHA,
          summary:
            "Waiting for the provider’s verification result in this same session. No household information is being entered or submitted.",
        });
        const observed = await page
          .waitForFunction(
            ({ expectedUrl, heading }) => {
              if (location.href !== expectedUrl) return true;
              const component = document.querySelector(
                "compass-ui-getting-started-captcha",
              );
              const next = component?.querySelector(
                'button#nextButtonID[aria-label="Next Button"]',
              );
              if (
                component?.querySelector("h1")?.textContent?.trim() ===
                  heading &&
                next instanceof HTMLButtonElement &&
                !next.disabled &&
                next.getBoundingClientRect().width > 0 &&
                next.getBoundingClientRect().height > 0
              )
                return true;
              return [...document.querySelectorAll("iframe")].some(
                (element) => {
                  try {
                    const src = new URL(element.getAttribute("src") ?? "");
                    const box = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return (
                      src.origin === "https://www.google.com" &&
                      [
                        "/recaptcha/api2/anchor",
                        "/recaptcha/api2/bframe",
                      ].includes(src.pathname) &&
                      !(
                        src.pathname.endsWith("/anchor") &&
                        src.searchParams.get("size") === "invisible"
                      ) &&
                      element.contentDocument === null &&
                      box.width >= 40 &&
                      box.height >= 40 &&
                      box.x >= 0 &&
                      box.y >= 0 &&
                      box.right <= innerWidth &&
                      box.bottom <= innerHeight &&
                      style.display !== "none" &&
                      style.visibility !== "hidden"
                    );
                  } catch {
                    return false;
                  }
                },
              );
            },
            { expectedUrl: url, heading: compassCaptchaHeading },
            { timeout: 5000, polling: 100 },
          )
          .then(
            () => true,
            (error: unknown) => {
              if (error instanceof errors.TimeoutError) return false;
              throw error;
            },
          );
        await check(job);
        if (page.url() !== url) continue;
        if (!observed) {
          const componentCount = await component.count();
          await check(job);
          if (page.url() !== url) continue;
          if (componentCount !== 1)
            throw new Error("browser_public_step_changed");
          return false;
        }
        continue;
      }
      clearFrame(job);
      update(job, {
        status: "running",
        summary:
          "Checking the provider’s next screen in this same browser session. No household information is being entered or submitted.",
      });
      if (
        url === COMPASS_INTRODUCTION_END ||
        url === COMPASS_HOUSEHOLD_DIVIDER
      ) {
        const heading =
          url === COMPASS_INTRODUCTION_END ? "Great job!" : "Household";
        const description =
          url === COMPASS_INTRODUCTION_END
            ? "You finished the first step."
            : "Now, let's enter information about the people in your household. A household is all the people who live in a housing unit together even if they are not related.";
        const title = page.getByRole("heading", { name: heading, exact: true });
        const text = page.getByText(description, { exact: true });
        const control = page.getByRole("button", {
          name:
            url === COMPASS_INTRODUCTION_END
              ? "Next Section Button"
              : "Next Button",
          exact: true,
        });
        await Promise.all([
          title.waitFor({ state: "visible", timeout: 3000 }),
          text.waitFor({ state: "visible", timeout: 3000 }),
          control.waitFor({ state: "visible", timeout: 3000 }),
        ]);
        const visible = (await title.isVisible()) && (await text.isVisible());
        const button = await control.elementHandle({ timeout: 3000 });
        if (
          !visible ||
          !button ||
          !(await button.isVisible()) ||
          !(await button.isEnabled()) ||
          (await button.getAttribute("id")) !== "nextButtonID"
        )
          throw new Error("browser_public_step_changed");
        await check(job);
        if (page.url() !== url) throw new Error("browser_page_changed");
        await button.click({ timeout: 2000 });
        await check(job);
        await page.waitForURL((next) => next.href !== url, { timeout: 5000 });
        continue;
      }
      if (url === COMPASS_HOUSEHOLD_ENTRY) {
        await Promise.all([
          page
            .getByRole("heading", {
              name: COMPASS_HOUSEHOLD_HEADING,
              exact: true,
            })
            .waitFor({ state: "visible", timeout: 3000 }),
          ...[
            "firstName",
            "lastName",
            "dob-datepicker-date",
            "gender_male",
            "gender_female",
          ].map((id) =>
            page.locator(`main input[id="${id}"][required]`).waitFor({
              state: "attached",
              timeout: 3000,
            }),
          ),
        ]);
        await check(job);
        if (page.url() !== url) throw new Error("browser_page_changed");
      }
      const observed = await compassHouseholdEntryObserved(page);
      await check(job);
      await close(
        job,
        observed
          ? "The official household form was reached in this same browser session. No household information was entered and no application was submitted."
          : "The provider page changed to an unsupported screen. CaseLink stopped without entering information or submitting an application.",
        observed ? "completed" : "blocked",
      );
      return false;
    }
    throw new Error("browser_public_step_limit");
  }

  async function presentHandoff(job: Job) {
    if (!(await observe(job))) return;
    if (job.controls.length >= 120) {
      await close(
        job,
        "This website check reached its interaction limit and has stopped. No application was submitted. Your saved support request is still available.",
        "blocked",
      );
      return;
    }
    const page = job.page!;
    const next = page.getByRole("button", { name: "Next Button", exact: true });
    const challenge = (await challengeFrames(page)).length > 0;
    const usable =
      (page.url() === COMPASS_FAMILY_SAFETY &&
        !job.continued &&
        (await next.isVisible()) &&
        (await next.isEnabled())) ||
      challenge;
    await check(job);
    if (!usable) {
      await close(
        job,
        "COMPASS has not provided a supported parent verification control. CaseLink stopped without entering information or submitting an application.",
        "blocked",
      );
      return;
    }
    update(job, {
      summary:
        job.continued || page.url() === COMPASS_CAPTCHA
          ? "You control the supported COMPASS verification area below. CaseLink will confirm the next screen in this same session; no household information is being entered."
          : "This preview pauses at the official Family Safety page so you can continue the website check yourself. This pause does not establish that every applicant must perform a personal verification step. No application is being submitted.",
    });
    await capture(job, page, challenge ? "challenge" : "continue");
  }

  function metadata(job: Job | undefined, grant: BrowserGrant) {
    return Response.json(
      {
        ok: true,
        available: publicBrowserAllowed(grant.authority, now()),
        reason: publicBrowserAllowed(grant.authority, now())
          ? null
          : "The request must have current permission to research Pennsylvania SNAP.",
        session: job?.session ?? null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  async function monitor(job: Job) {
    if (!job.parentPhase || job.controlling || closed(job)) return;
    job.controlling = true;
    try {
      await presentHandoff(job);
    } catch {
      if (!closed(job))
        await close(
          job,
          "The website check stopped because the provider page or permission changed. No application was submitted.",
          "blocked",
        );
    } finally {
      job.controlling = false;
    }
  }
  async function run(job: Job) {
    try {
      await check(job);
      const context = await ports.context();
      if (closed(job)) {
        await context.close();
        return;
      }
      job.context = context;
      await context.routeWebSocket("**/*", (socket) => socket.close());
      await context.route("**/*", (route) =>
        compassResourceAllowed(
          route.request().url(),
          route.request().isNavigationRequest() &&
            !route.request().frame().parentFrame(),
        )
          ? route.continue()
          : route.abort(),
      );
      let mainPage: Page | null = null;
      context.on("page", (page) => {
        if (mainPage) {
          void page.close();
          return;
        }
        mainPage = page;
        page.on("download", (download) => {
          void download.cancel();
        });
      });
      const page = await context.newPage();
      job.page = page;
      page.on("popup", (popup) => {
        void popup.close();
      });
      page.on("framenavigated", (frame) => {
        if (job.parentPhase && frame === page.mainFrame()) clearFrame(job);
      });
      page.setDefaultTimeout(15000);
      update(job, {
        status: "running",
        summary:
          "Checking the official public SNAP application steps. No household information is being entered or submitted.",
        title: "Pennsylvania COMPASS",
      });
      const at = async (path: string, text: string, render = true) => {
        await page.waitForURL(
          `https://www.compass.dhs.pa.gov/intake/#/${path}`,
        );
        await page.getByText(text, { exact: false }).first().waitFor();
        if (render) await capture(job, page);
      };
      const next = async () => {
        await check(job);
        await page
          .getByRole("button", { name: "Next Button", exact: true })
          .click();
      };
      await check(job);
      await page.goto(COMPASS_ENTRY, { waitUntil: "domcontentloaded" });
      await at("getstarted", "How would you like to get started?");
      await check(job);
      await page
        .getByRole("button", { name: /^apply now$/i })
        .last()
        .click();
      await at("applynow/gettingstarted", "Ready to begin?");
      await check(job);
      await page
        .getByRole("button", { name: "Get Started Button", exact: true })
        .click();
      await at("applynow/gettingstarted/tutorial", "Let's review some terms");
      await next();
      await at(
        "applynow/gettingstarted/importantinformation",
        "keep your information private",
      );
      await next();
      await at("applynow/gettingstarted/submitreferral", "Early Intervention");
      await check(job);
      await page.locator('label[for="N"]').click();
      await next();
      await at(
        "applynow/gettingstarted/WICpreapplication",
        "Women, Infants, and Children",
      );
      await next();
      await at("applynow/gettingstarted/gatepost", "Who are you applying for?");
      await check(job);
      await page.locator('label[for="FamMem"]').click();
      await next();
      await at(
        "applynow/gettingstarted/existingaccount",
        "Do you already have a My COMPASS account?",
      );
      await check(job);
      await page.locator('label[for="N"]').click();
      await next();
      await at("applynow/gettingstarted/familysafety", "Family Safety", false);
      job.parentPhase = true;
      job.controlling = true;
      try {
        await presentHandoff(job);
      } finally {
        job.controlling = false;
      }
    } catch {
      if (!closed(job))
        await close(
          job,
          "The website check stopped because the provider page, permission, or connection changed. No application was submitted.",
          "blocked",
        );
    }
  }
  const sweep = async () => {
    for (const job of jobs.values()) {
      if (closed(job)) {
        if (Date.parse(job.session.updatedAt) + 60000 < now())
          jobs.delete(job.grant.authority.id);
        continue;
      }
      try {
        await check(job);
        await monitor(job);
      } catch {
        await close(
          job,
          "Website access stopped because this permission or session ended. No application was submitted.",
        );
      }
    }
  };
  return {
    async read(
      token: string,
      requestId: string,
      method: "GET" | "POST" | "DELETE",
      frame = false,
      expectedFrameId?: string,
    ) {
      const grant = await ports.authorize(token, requestId);
      let job = jobs.get(requestId);
      if (job && job.grant.ownerId !== grant.ownerId)
        throw new Error("browser_not_owned");
      if (method === "DELETE" && job) {
        await close(
          job,
          "Website viewer stopped. No application was submitted.",
        );
        return metadata(job, grant);
      }
      if (job && job.grant.authority.version !== grant.authority.version)
        await close(
          job,
          "Website access stopped because this request changed. No application was submitted.",
        );
      if (job && !closed(job)) {
        try {
          await check(job);
          if (!frame) await monitor(job);
        } catch {
          await close(
            job,
            "Website access stopped because this permission or session ended. No application was submitted.",
          );
        }
      }
      if (
        method === "POST" &&
        (!job || ["closed", "blocked", "failed"].includes(job.session.status))
      ) {
        if (
          !publicBrowserAllowed(grant.authority, now()) ||
          grant.expiresAt <= now()
        )
          throw new Error("browser_not_authorized");
        if (job) await close(job, "Website viewer restarted.");
        const active = [...jobs.values()].filter(
          (candidate) =>
            !closed(candidate) && candidate.session.status !== "blocked",
        );
        if (
          active.length >= 4 ||
          active.some((candidate) => candidate.grant.ownerId === grant.ownerId)
        )
          throw new Error("browser_capacity");
        job = {
          grant,
          token,
          frame: null,
          deliveredFrameId: null,
          context: null,
          page: null,
          parentPhase: false,
          controlling: false,
          continued: false,
          controls: [],
          challengeBoxes: [],
          session: {
            id: randomUUID(),
            programId: "snap-pa",
            status: "starting",
            currentUrl: null,
            title: "Pennsylvania COMPASS",
            summary:
              "Opening the public COMPASS application steps. No household information will be entered or submitted.",
            updatedAt: new Date(now()).toISOString(),
            canControl: false,
            frameUrl: null,
            handoff: null,
          },
        };
        jobs.set(requestId, job);
        void run(job);
      }
      if (frame) {
        if (!job?.frame || closed(job))
          return new Response(null, { status: 404 });
        if (
          job.session.handoff &&
          job.session.handoff.frameId !== expectedFrameId
        )
          throw new Error("browser_stale_frame");
        const bytes = job.frame;
        const frameId = job.session.handoff?.frameId;
        await check(job);
        if (job.frame !== bytes || job.session.handoff?.frameId !== frameId)
          throw new Error("browser_stale_frame");
        job.deliveredFrameId = frameId ?? null;
        return new Response(Buffer.from(bytes), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return metadata(job, grant);
    },
    async control(token: string, requestId: string, value: unknown) {
      const input = browserControlSchema.parse(value);
      const grant = await ports.authorize(token, requestId);
      const job = jobs.get(requestId);
      if (!job || job.grant.ownerId !== grant.ownerId)
        throw new Error("browser_not_owned");
      if (job.controlling) throw new Error("browser_control_busy");
      if (
        job.session.id !== input.sessionId ||
        job.session.handoff?.frameId !== input.frameId ||
        job.deliveredFrameId !== input.frameId ||
        !job.session.canControl ||
        job.session.status !== "needs_parent"
      )
        throw new Error("browser_stale_frame");
      job.controlling = true;
      let accepted = false;
      try {
        await check(job);
        if (!(await observe(job))) return metadata(job, grant);
        const page = job.page!;
        const handoff = job.session.handoff!;
        let target: ElementHandle | null = null;
        let position: { x: number; y: number } | undefined;
        let challenge: Frame | undefined;
        let clickedFrame:
          | { handle: ElementHandle; box: Box; point: { x: number; y: number } }
          | undefined;
        let keyboardEntry: ElementHandle | undefined;
        if (input.action.type === "continue") {
          if (
            handoff.kind !== "continue" ||
            job.continued ||
            page.url() !== COMPASS_FAMILY_SAFETY
          )
            throw new Error("browser_control_target");
          target = await page
            .getByRole("button", { name: "Next Button", exact: true })
            .elementHandle();
          if (
            !target ||
            !(await target.isVisible()) ||
            !(await target.isEnabled())
          )
            throw new Error("browser_control_target");
        } else if (
          input.action.type === "click" ||
          input.action.type === "key"
        ) {
          if (handoff.kind !== "challenge")
            throw new Error("browser_control_target");
          const frames = await challengeFrames(page);
          for (const candidate of frames) {
            const displayed = job.challengeBoxes.find(
              ({ frame }) => frame === candidate.frame,
            );
            if (!displayed || !sameBox(displayed.box, candidate.box)) continue;
            if (input.action.type === "click") {
              const point = {
                x: input.action.x * handoff.width,
                y: input.action.y * handoff.height,
              };
              const box = candidate.box;
              if (
                point.x < box.x ||
                point.x >= box.x + box.width ||
                point.y < box.y ||
                point.y >= box.y + box.height
              )
                continue;
              if (
                !(await candidate.handle.evaluate(
                  (element, point) =>
                    element.ownerDocument?.elementFromPoint(
                      point.x,
                      point.y,
                    ) === element,
                  point,
                ))
              )
                continue;
              target = candidate.handle;
              position = { x: point.x - box.x, y: point.y - box.y };
              clickedFrame = { handle: candidate.handle, box, point };
            } else {
              const active = await candidate.handle.evaluate(
                (element) => element.ownerDocument?.activeElement === element,
              );
              if (!active && input.action.key !== "Tab") continue;
              target = await candidate.frame
                .locator(active ? ":focus" : "body")
                .elementHandle();
              if (!active && target) keyboardEntry = candidate.handle;
            }
            if (target) {
              challenge = candidate.frame;
              break;
            }
          }
          if (!target || !challenge) throw new Error("browser_control_target");
        }
        await check(job);
        if (
          clickedFrame &&
          (!sameBox(
            clickedFrame.box,
            await clickedFrame.handle.boundingBox(),
          ) ||
            !(await clickedFrame.handle.evaluate(
              (element, point) =>
                element.ownerDocument?.elementFromPoint(point.x, point.y) ===
                element,
              clickedFrame.point,
            )))
        )
          throw new Error("browser_control_target");
        if (
          ![COMPASS_FAMILY_SAFETY, COMPASS_CAPTCHA].includes(page.url()) ||
          job.session.handoff?.frameId !== input.frameId
        )
          throw new Error("browser_page_changed");
        await presentHandoff(job);
        if (closed(job)) return metadata(job, grant);
        if (job.session.handoff?.frameId !== input.frameId)
          throw new Error("browser_stale_frame");
        const viewport = page.viewportSize();
        if (
          ![COMPASS_FAMILY_SAFETY, COMPASS_CAPTCHA].includes(page.url()) ||
          job.session.handoff?.frameId !== input.frameId ||
          !viewport ||
          viewport.width !== handoff.width ||
          viewport.height !== handoff.height ||
          (challenge && !recaptchaFrameAllowed(challenge.url()))
        )
          throw new Error("browser_page_changed");
        if (job.controls.filter((time) => time > now() - 10000).length >= 12)
          throw new Error("browser_control_rate");
        job.controls.push(now());
        accepted = true;
        clearFrame(job);
        if (input.action.type === "continue") {
          job.continued = true;
          update(job, {
            status: "running",
            summary:
              "Waiting for COMPASS after your continuation in this same session. No household information is being entered or submitted.",
          });
          await target!.click({ timeout: 2000 });
          await check(job);
          await page
            .waitForURL((url) => url.href !== COMPASS_FAMILY_SAFETY, {
              timeout: 5000,
            })
            .catch(() => undefined);
        } else if (input.action.type === "click") {
          await target!.click({ position, timeout: 2000 });
        } else if (input.action.type === "key") {
          if (keyboardEntry) {
            await keyboardEntry.focus();
            await check(job);
            if (
              ![COMPASS_FAMILY_SAFETY, COMPASS_CAPTCHA].includes(page.url()) ||
              !challenge ||
              !recaptchaFrameAllowed(challenge.url())
            )
              throw new Error("browser_page_changed");
          }
          await target!.press(input.action.key, { timeout: 2000 });
        }
        await check(job);
        await presentHandoff(job);
        return metadata(job, grant);
      } catch (error) {
        const rejected =
          error instanceof Error &&
          [
            "browser_control_target",
            "browser_control_rate",
            "browser_stale_frame",
          ].includes(error.message);
        if (!closed(job) && (accepted || !rejected))
          await close(
            job,
            "The website check stopped because the provider page, connection, or permission changed. No application was submitted.",
            "blocked",
          );
        throw error;
      } finally {
        job.controlling = false;
      }
    },
    sweep,
    async close() {
      await Promise.all(
        [...jobs.values()].map((job) => close(job, "Website viewer stopped.")),
      );
      jobs.clear();
    },
  };
}

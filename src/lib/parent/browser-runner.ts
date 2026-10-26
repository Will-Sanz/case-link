import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { compassHouseholdEntryObserved } from "./compass-household-entry";
import {
  COMPASS_ENTRY,
  compassResourceAllowed,
  publicBrowserAllowed,
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
  frame: Uint8Array | null;
};
type Ports = {
  authorize(token: string, requestId: string): Promise<BrowserGrant>;
  context(): Promise<BrowserContext>;
  now?: () => number;
};

/** A deliberately read-only public recipe, never a general computer or application submitter. */
export function createApplicationBrowser(ports: Ports) {
  // shortcut: one localhost viewer holds at most four ephemeral sessions; use a dedicated broker before a hosted release.
  const jobs = new Map<string, Job>();
  const now = ports.now ?? Date.now;
  const closed = (job: Job) =>
    ["closed", "failed", "blocked"].includes(job.session.status);
  function update(job: Job, values: Partial<ApplicationBrowserSession>) {
    Object.assign(job.session, values, {
      updatedAt: new Date(now()).toISOString(),
    });
  }
  async function close(
    job: Job,
    summary: string,
    status: "closed" | "blocked" = "closed",
  ) {
    update(job, { status, summary, frameUrl: null });
    job.frame = null;
    job.token = "";
    const context = job.context;
    job.context = null;
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
  async function capture(job: Job, page: Page) {
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
    ];
    if (!compassResourceAllowed(page.url(), true) || !paths.includes(path))
      throw new Error("browser_protected_boundary");
    const frame = await page.screenshot({
      type: "jpeg",
      quality: 65,
      animations: "disabled",
      mask: [
        page.locator("input, textarea, select, [contenteditable], iframe"),
      ],
      maskColor: "#dcd8ed",
    });
    await check(job);
    job.frame = frame;
    update(job, {
      currentUrl: `https://www.compass.dhs.pa.gov/intake/#/${path}`,
      frameUrl: `/api/parent/requests/${job.grant.authority.id}/browser/frame`,
    });
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
      page.on("popup", (popup) => {
        void popup.close();
      });
      page.setDefaultTimeout(15000);
      update(job, {
        status: "running",
        summary:
          "Checking the official public SNAP application steps. No household information is being entered or submitted.",
        title: "Pennsylvania COMPASS",
      });
      const at = async (path: string, text: string) => {
        await page.waitForURL(
          `https://www.compass.dhs.pa.gov/intake/#/${path}`,
        );
        await page.getByText(text, { exact: false }).first().waitFor();
        await capture(job, page);
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
      await at("applynow/gettingstarted/familysafety", "Family Safety");
      await next();
      await page.waitForFunction(
        () =>
          location.hash.includes("/household") ||
          document.body.innerText.includes(
            "We were unable to verify your information",
          ),
      );
      await check(job);
      if (page.url().includes("/household")) {
        const observed = await compassHouseholdEntryObserved(page);
        await check(job);
        await close(
          job,
          observed
            ? "The official household form is reachable. CaseLink needs its protected application connection before it can enter or submit household information."
            : "A household page appeared, but its expected fields could not be confirmed. CaseLink stopped without entering or submitting household information.",
          "blocked",
        );
      } else if (
        await page
          .getByText(
            "We were unable to verify your information at this time. You can try again.",
            { exact: true },
          )
          .isVisible()
      ) {
        await close(
          job,
          "COMPASS blocked this automated page check. No household fields were entered or submitted. You can continue separately on the official site; CaseLink cannot resume that application through this viewer yet.",
          "blocked",
        );
      } else {
        await close(
          job,
          "The provider verification result could not be confirmed. No household information was entered or submitted.",
          "blocked",
        );
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
    ) {
      const grant = await ports.authorize(token, requestId);
      let job = jobs.get(requestId);
      if (job && job.grant.ownerId !== grant.ownerId)
        throw new Error("browser_not_owned");
      if (job && job.grant.authority.version !== grant.authority.version)
        await close(
          job,
          "Website access stopped because this request changed. No application was submitted.",
        );
      if (job && !closed(job)) {
        try {
          await check(job);
        } catch {
          await close(
            job,
            "Website access stopped because this permission or session ended. No application was submitted.",
          );
        }
      }
      if (method === "DELETE" && job)
        await close(
          job,
          "Website viewer stopped. No application was submitted.",
        );
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
          context: null,
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
          },
        };
        jobs.set(requestId, job);
        void run(job);
      }
      if (frame) {
        if (!job?.frame || closed(job))
          return new Response(null, { status: 404 });
        await check(job);
        return new Response(Buffer.from(job.frame), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
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

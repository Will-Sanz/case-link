import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fixtures from "../../src/lib/parent/test-fixtures.ts";
import * as planning from "../../src/lib/parent/planning.ts";
const { fixtureRequest, fixtureIntake, fixtureMandate, fixtureNow } =
  fixtures.default ?? fixtures;
const { buildSupportPlan, requiredActions } = planning.default ?? planning;
const origin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3200",
  directory = "tmp/parent-verification/production-ux";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "UX verification is local and synthetic only.");
mkdirSync(directory, { recursive: true });
const intake = fixtureIntake({ accountAuthority: "not_sure" }),
  mandate = fixtureMandate();
const request = fixtureRequest({
  intake,
  mandate,
  plan: buildSupportPlan(fixtureRequest({ intake, mandate }), fixtureNow),
  required_actions: [...requiredActions(intake, mandate), {
    id: "synthetic-amount", need: "electricity", reason: "missing_fact", resolver: "parent",
    field: "amountDue", title: "Electric bill amount due",
    explanation: "Synthetic factual question for this interaction check, not a live provider requirement.",
  }],
  events: [],
  documents: [],
});
const savedProgress = {
  state: "needs_parent",
  summary:
    "Your answer is needed for the electric account. Other recorded work remains separate.",
  updatedAt: fixtureNow.toISOString(),
  nextRunAt: null,
  canContinueAfterClosing: false,
};
const answeredConversation = {
  available: true,
  unavailableReason: null,
  historyLimited: false,
  messages: [
    {
      id: "synthetic-question",
      question: "Has an application been sent?",
      status: "answered",
      error: null,
      created_at: fixtureNow.toISOString(),
      updated_at: fixtureNow.toISOString(),
      answer: {
        intro: "No application has been sent for this request.",
        paragraphs: [
          {
            text: "An answer about your utility account is still needed. Your food options are recorded separately.",
            sourceLabel: "Your saved request",
            recordedAt: fixtureNow.toISOString(),
          },
        ],
        actionIds: [],
      },
    },
  ],
};
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const [name, width, height] of [
    ["laptop", 1440, 1000],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    let rejectAnswer = false,
      activeRequest = request,
      assistantConversation = answeredConversation;
    await page.route("**/api/parent/**", async (route) => {
      const url = new URL(route.request().url()),
        method = route.request().method();
      let status = 200,
        body = { ok: true, request: activeRequest, progress: savedProgress };
      if (url.pathname.endsWith("/account"))
        body = {
          ok: true,
          account: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "family@example.test",
            preferences: {
              contactPreference: "in_app",
              language: "en",
              quietHoursStart: 19,
              quietHoursEnd: 9,
            },
          },
        };
      else if (url.pathname.endsWith("/authorization-window"))
        body = {
          ok: true,
          authorization: {
            issuedAt: "2026-10-26T12:00:00.000Z",
            expiresAt: "2026-11-25T12:00:00.000Z",
          },
        };
      else if (url.pathname.endsWith("/capabilities"))
        body = {
          ok: true,
          capabilities: [
            { programId: "philly-food", enabled: true, actions: ["share"] },
            { programId: "peco-cap", enabled: true, actions: ["submit"] },
          ],
        };
      else if (url.pathname.endsWith("/food-sites"))
        body = {
          ok: true,
          sites: [],
          checkedAt: fixtureNow.toISOString(),
          sourceUrl: "https://www.phila.gov/food/",
          availability: "city_listed_unconfirmed",
          moreSitesAvailable: false,
        };
      else if (url.pathname.endsWith("/partners"))
        body = { ok: true, partners: [] };
      else if (url.pathname.endsWith("/browser"))
        body = {
          ok: true,
          available: false,
          reason:
            "The synthetic browser fixture has no application connection. No application is being filled or submitted.",
          session: null,
        };
      else if (url.pathname.endsWith("/assistant")) {
        if (method === "POST") {
          const submitted = route.request().postDataJSON();
          assert.equal(submitted.consented, true);
          assistantConversation = {
            ...assistantConversation,
            messages: [
              ...assistantConversation.messages,
              {
                id: "synthetic-pending",
                question: submitted.question,
                status: "queued",
                answer: null,
                error: null,
                created_at: fixtureNow.toISOString(),
                updated_at: fixtureNow.toISOString(),
              },
            ],
          };
          body = { ok: true, id: "synthetic-pending" };
          status = 202;
        } else if (method === "DELETE") {
          assert.equal(
            route.request().postDataJSON().messageId,
            "synthetic-pending",
          );
          assistantConversation = {
            ...assistantConversation,
            messages: assistantConversation.messages.map((message) =>
              message.id === "synthetic-pending"
                ? {
                    ...message,
                    status: "failed",
                    error: "You cancelled this question.",
                  }
                : message,
            ),
          };
          body = { ok: true };
        } else body = { ok: true, ...assistantConversation };
      } else if (url.pathname.endsWith("/operations"))
        body = { ok: true, operations: [], historyLimited: false };
      else if (url.pathname.endsWith("/requests") && method === "GET")
        body = {
          ok: true,
          requests: [activeRequest],
          progress: { [activeRequest.id]: savedProgress },
        };
      else if (url.pathname.endsWith("/auth")) {
        body = { ok: true };
        if (
          ["verify_code", "sign_in"].includes(
            route.request().postDataJSON().action,
          )
        ) {
          status = 400;
          body = {
            ok: false,
            error:
              route.request().postDataJSON().action === "verify_code"
                ? "That code expired. Request a new one."
                : "Check your email and password, then try again.",
          };
        }
      } else if (method === "POST" && route.request().postDataJSON().action === "answer_facts") {
        const payload = route.request().postDataJSON();
        assert.equal(payload.version, activeRequest.version);
        assert.equal(payload.answers.length, 2);
        assert.ok(payload.answers.some((answer) => answer.field === "accountAuthority" && answer.value === "self"));
        assert.ok(payload.answers.some((answer) => answer.field === "amountDue" && answer.value === 45));
        if (rejectAnswer) {
          status = 409;
          body = { ok: false, error: "This request changed. Refresh it before saving your answer." };
        } else {
          activeRequest = { ...activeRequest, version: activeRequest.version + 2,
            required_actions: activeRequest.required_actions.map((action) =>
              payload.answers.some((answer) => answer.need === action.need && answer.field === action.field)
                ? { ...action, resolved: true } : action),
          };
          body = { ok: true, request: activeRequest, progress: savedProgress };
        }
      } else if (method === "POST" && rejectAnswer) {
        status = 409;
        body = {
          ok: false,
          error: "This request changed. Refresh it before saving your answer.",
        };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    async function snapshot(label, target) {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
      );
      const file = `${directory}/${name}-${label}.png`;
      // Chromium can stitch the offscreen fixed skip link into tall captures.
      const captureStyle =
        'a[href="#main-content"]:not(:focus) { visibility: hidden !important; }';
      if (target) await target.screenshot({ path: file, style: captureStyle });
      else
        await page.screenshot({
          path: file,
          fullPage: true,
          style: captureStyle,
        });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      results.push({
        viewport: name,
        state: label,
        file,
        overflow,
        violations: axe.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => node.target),
        })),
      });
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("href")),
      "#main-content",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "main-content",
    );
    await snapshot("home");
    await page.goto(`${origin}/get-support?need=food`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: "Ask CaseLink for food-access support" }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("checkbox", { name: /Food for now/ }).check();
    await page.getByLabel("Electric bill", { exact: true }).check();
    await snapshot("needs");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Household ZIP code").fill("19104");
    await page.getByLabel(/18 or older/).check();
    const zipBox = await page.getByLabel("Household ZIP code").boundingBox();
    const languageBox = await page
      .getByLabel("Preferred service language")
      .boundingBox();
    assert.ok(
      zipBox && languageBox,
      "Both household routing fields must be rendered.",
    );
    assert.ok(
      [zipBox.height, languageBox.height].every(
        (value) => value >= 48 && value <= 54,
      ),
      "ZIP and language controls must have matching usable heights.",
    );
    assert.ok(
      Math.abs(zipBox.height - languageBox.height) <= 2,
      "Input and select control heights must align.",
    );
    if (width >= 600)
      assert.ok(
        Math.abs(zipBox.y - languageBox.y) <= 2,
        "Help text must not push the adjacent language control out of alignment.",
      );
    await snapshot("details");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await snapshot("permission-review");
    await page.goto(`${origin}/support/${request.id}`, {
      waitUntil: "networkidle",
    });
    await snapshot("support-detail");
    const launcher = page.getByRole("button", {
      name: "Ask CaseLink for assistance",
    });
    await launcher.click();
    const chat = page.getByRole("dialog", {
      name: "Ask CaseLink",
      exact: true,
    });
    await chat.waitFor();
    await page
      .getByText("No application has been sent for this request.", {
        exact: true,
      })
      .waitFor();
    const question = chat.getByLabel("Your question about this request");
    await question.fill("A draft about this request");
    await page.keyboard.press("Escape");
    assert.equal(
      await chat.isVisible(),
      false,
      "Escape must minimize the chat.",
    );
    assert.equal(
      await launcher.evaluate((element) => document.activeElement === element),
      true,
      "Minimizing chat must return focus to its launcher.",
    );
    await launcher.click();
    assert.equal(
      await question.inputValue(),
      "A draft about this request",
      "Minimizing must preserve the unsent draft.",
    );
    assert.equal(
      await chat.getByRole("checkbox").isChecked(),
      false,
      "Opening chat must never authorize AI processing automatically.",
    );
    if (width < 600) {
      await chat.getByRole("button", { name: "Minimize chat" }).focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await chat.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
        "Phone chat must retain keyboard focus inside its native modal.",
      );
      await page.setViewportSize({ width, height: 480 });
      await page.waitForFunction(() => {
        const bounds = document
          .querySelector("#caselink-assistant")
          ?.getBoundingClientRect();
        return (
          bounds && bounds.y >= 0 && bounds.bottom <= window.innerHeight + 1
        );
      });
      const compactBounds = await chat.boundingBox();
      assert.ok(
        compactBounds &&
          compactBounds.y >= 0 &&
          compactBounds.y + compactBounds.height <= 481,
        "The phone chat must fit the shortened viewport without covering its close control.",
      );
      await page.setViewportSize({ width, height });
    }
    await snapshot("assistant-answer", chat);
    await page
      .getByLabel("Your question about this request")
      .fill("What happens next?");
    await page
      .getByLabel(
        /Use my question and relevant saved request details with OpenAI/,
      )
      .check();
    await page
      .getByRole("button", { name: "Ask CaseLink", exact: true })
      .click();
    await page
      .getByText("Question saved. Waiting for the assistant to begin.")
      .waitFor();
    await page.waitForFunction(() => {
      const history = document.querySelector(
        'ol[aria-label="Conversation about this request"]',
      );
      return (
        history &&
        history.scrollHeight - history.scrollTop - history.clientHeight < 2
      );
    });
    await snapshot(
      "assistant-queued",
      page.getByRole("dialog", { name: "Ask CaseLink", exact: true }),
    );
    await page
      .getByRole("button", { name: "Cancel question", exact: true })
      .click();
    await page.getByText("You cancelled this question.").waitFor();
    await snapshot(
      "assistant-cancelled",
      page.getByRole("dialog", { name: "Ask CaseLink", exact: true }),
    );
    assistantConversation = {
      ...answeredConversation,
      messages: [
        {
          ...answeredConversation.messages[0],
          answer: {
            ...answeredConversation.messages[0].answer,
            paragraphs: [
              {
                text: "Earlier recorded context remains available for review. ".repeat(
                  40,
                ),
                sourceLabel: "Synthetic request history",
              },
            ],
          },
        },
        {
          ...answeredConversation.messages[0],
          id: "synthetic-long-history",
          question: "Latest history question",
          status: "queued",
          answer: null,
        },
      ],
    };
    await page
      .getByRole("button", { name: "Refresh assistant conversation" })
      .click();
    await page.getByText("Latest history question").waitFor();
    await page.waitForFunction(() => {
      const history = document.querySelector(
        'ol[aria-label="Conversation about this request"]',
      );
      return (
        history &&
        history.scrollHeight > history.clientHeight &&
        history.scrollHeight - history.scrollTop - history.clientHeight < 2
      );
    });
    const history = page.getByRole("list", {
      name: "Conversation about this request",
    });
    await history.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    const historyReload = page.waitForResponse(
      (response) =>
        response.url().endsWith("/assistant") &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Refresh assistant conversation" })
      .click();
    await historyReload;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await history.evaluate((element) => element.scrollTop),
      0,
      "Refreshing must preserve a parent reading earlier answers.",
    );
    assistantConversation = {
      ...answeredConversation,
      available: false,
      unavailableReason:
        "An active assistant connection is unavailable. No new question will be sent.",
    };
    await page
      .getByRole("button", { name: "Refresh assistant conversation" })
      .click();
    await page
      .getByText(
        "An active assistant connection is unavailable. No new question will be sent.",
      )
      .waitFor();
    await snapshot(
      "assistant-offline",
      page.getByRole("dialog", { name: "Ask CaseLink", exact: true }),
    );
    await chat.getByRole("button", { name: "Minimize chat" }).click();
    assert.equal(
      await chat.isVisible(),
      false,
      "Close chat before returning to the application controls.",
    );
    rejectAnswer = true;
    await page
      .getByLabel("How are you connected to the account?")
      .selectOption("self");
    await page.locator("#answer-synthetic-amount").fill("45");
    await page
      .getByRole("button", { name: "Save all answers and continue", exact: true })
      .click();
    await page.getByRole("main").getByRole("alert").waitFor();
    await snapshot("answer-error");
    rejectAnswer = false;
    activeRequest = { ...request, version: 2 };
    await page.getByRole("button", { name: "Review latest questions" }).click();
    await page.getByText(/latest saved answers and questions are loaded/).waitFor();
    await snapshot("answer-recovered");
    await page.getByLabel("How are you connected to the account?").selectOption("self");
    await page.locator("#answer-synthetic-amount").fill("45");
    await page.getByRole("button", { name: "Save all answers and continue", exact: true }).click();
    await page.getByText("All your answers are saved. Permitted work can continue.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Save all answers and continue", exact: true }).count(), 0);
    await snapshot("answers-saved");
    await page
      .getByRole("button", { name: "Change or renew permission" })
      .click();
    await snapshot(
      "permission-editor",
      page
        .getByRole("heading", { name: "Your permission", exact: true })
        .locator(".."),
    );
    await page
      .getByText("Add a document or take a photo", { exact: true })
      .click();
    await snapshot(
      "document-consent",
      page.getByRole("heading", { name: "Bills & documents" }).locator(".."),
    );
    const combinedIntake = fixtureIntake({
        needs: ["electricity", "gas"],
        accountAuthority: "not_sure",
      }),
      combinedMandate = fixtureMandate({
        recipientIds: ["peco-cap", "pgw-crp"],
      });
    activeRequest = fixtureRequest({
      intake: combinedIntake,
      mandate: combinedMandate,
      plan: buildSupportPlan(fixtureRequest({ intake: combinedIntake, mandate: combinedMandate }), fixtureNow),
      required_actions: [
        ...combinedIntake.needs.map((need) => ({
          id: `authority-${need}`,
          need,
          reason: "missing_fact",
          resolver: "parent",
          field: "accountAuthority",
          title: "Can you act for this utility account?",
          explanation: "Your answer applies only to this utility account.",
        })),
        ...requiredActions(combinedIntake, combinedMandate).filter(
          (action) => action.resolver === "operator",
        ),
      ],
      documents: [],
      events: [],
    });
    await page.goto(`${origin}/support/${request.id}`, {
      waitUntil: "networkidle",
    });
    assert.equal(
      await page
        .getByRole("region", {
          name: /bill Can you act for this utility account/,
        })
        .count(),
      2,
    );
    await snapshot("combined-accounts");
    activeRequest = {
      ...activeRequest,
      required_actions: [
        {
          id: "missing-scope",
          need: "electricity",
          reason: "expanded_permission",
          resolver: "parent",
          title: "Allow required income information",
          explanation:
            "This named program requires income information. Review your permission before it is used.",
        },
      ],
    };
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Review permission", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("type")),
      "checkbox",
    );
    await snapshot(
      "permission-handoff",
      page
        .getByRole("heading", { name: "Your permission", exact: true })
        .locator(".."),
    );
    activeRequest = request;
    await page.goto(`${origin}/account`, { waitUntil: "networkidle" });
    await snapshot("account");
    await page.goto(`${origin}/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel("Your email address").fill("family@example.test");
    const codeOption = page.getByRole("button", {
      name: "Use an email code instead",
    });
    if (await codeOption.count()) {
      await codeOption.click();
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page.getByLabel("Email code").fill("123456");
    } else {
      await page
        .getByLabel("Password", { exact: true })
        .fill("synthetic-wrong-password");
    }
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("main").getByRole("alert").waitFor();
    await snapshot("sign-in-recovery");
    await page.goto(`${origin}/support/help`, { waitUntil: "networkidle" });
    await snapshot("help");
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(
  `${directory}/results.json`,
  JSON.stringify(
    {
      notice:
        "Actual production UI with explicitly synthetic API fixtures. No live Auth, model, partner or family data used.",
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    screens: results.length,
    overflow: results.filter((item) => item.overflow),
    accessibility: results.filter((item) => item.violations.length),
  }),
);
assert.equal(
  results.some((item) => item.overflow || item.violations.length),
  false,
  "Fix production UI accessibility/reflow findings.",
);

/** Opt-in real-provider rehearsal: no API interception, real family data or partner submission. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readConnectedProbeFixture } from "./parent-connected-probe-fixture";
import { getProgramsForNeeds } from "../src/lib/parent/programs";
import type { SupportIntake, SupportRequest } from "../src/lib/parent/domain";
import type { ParentAssistantConversation } from "../src/lib/parent/assistant-contract";
import { supportProgressSchema } from "../src/lib/parent/progress";

let stage = "explicit synthetic authorization";
const checks: string[] = [];
function check(value: unknown, label: string): asserts value {
  assert.ok(value, label);
  checks.push(label);
}
async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
) {
  const end = Date.now() + 150000;
  do {
    const value = await read();
    if (ready(value)) return value;
    await delay(1000);
  } while (Date.now() < end);
  throw new Error("The actual background operation did not finish in time.");
}
async function main() {
  check(
    process.env.CASELINK_PARENT_CONNECTED_PROBE_APPROVED === "1" &&
      process.env.CASELINK_PARENT_CONNECTED_AI_PROBE_APPROVED === "1",
    "The synthetic real-provider background-AI rehearsal is explicitly enabled.",
  );
  const fixture = readConnectedProbeFixture(
    process.env.CASELINK_PARENT_CONNECTED_FIXTURE_FILE ?? "",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const origin = fixture.origin;
    const page = await context.newPage();
    stage = "actual password sign-in";
    await page.goto(`${origin}/sign-in`);
    await page.getByLabel("Your email address").fill(fixture.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${origin}/my-support`);
    check(
      (await context.request.get(`${origin}/api/parent/account`)).ok(),
      "The disposable existing identity signs in with its original password.",
    );
    stage = "actual original partners and public City food directory";
    const partners = await context.request.get(`${origin}/api/parent/partners`);
    const directory = await partners.json();
    check(
      partners.ok() &&
        directory.partners.length === 4 &&
        directory.partners.every(
          (p: { relationship: string; execution: string }) =>
            p.relationship === "existing_partner" &&
            p.execution === "not_connected",
        ),
      "Four original partner resources load with honest connection status.",
    );
    const food = await context.request.get(
      `${origin}/api/parent/food-sites?zip=19104`,
    );
    const foodResult = await food.json();
    check(
      food.ok() &&
        foodResult.sites.length > 0 &&
        foodResult.sites.every((s: { zip: string }) => s.zip === "19104") &&
        foodResult.availability === "city_listed_unconfirmed",
      "The live City directory returns actual ZIP-matched food sites without claiming availability.",
    );
    stage = "bounded combined-needs preparation";
    const intake: SupportIntake = {
      needs: ["food_now", "snap_new", "electricity"],
      urgency: "soon",
      zip: "19104",
      language: "en",
      householdSize: 3,
      childrenUnderFive: null,
      pregnantOrPostpartum: null,
      incomeAmount: null,
      incomeFrequency: "unknown",
      utilityProviders: ["peco"],
      shutoffDate: null,
      accountAuthority: "self",
      contactPreference: "in_app",
      adultConfirmed: true,
    };
    const timing = await context.request.get(
      `${origin}/api/parent/authorization-window`,
    );
    check(
      timing.ok(),
      "Authorization timing comes from the actual database clock.",
    );
    const authorization = (await timing.json()).authorization;
    const programs = getProgramsForNeeds(intake.needs);
    const started = await context.request.post(
      `${origin}/api/parent/requests`,
      {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
          intake,
          mandate: {
            version: 1,
            mode: "prepare_only",
            recipientIds: programs.map((p) => p.id),
            allowedActions: ["research", "prepare"],
            allowedData: ["household", "income", "utility", "documents"],
            expiresAt: authorization.expiresAt,
            maxAttempts: 12,
            maxRecipients: programs.length,
            bookingPreference: "ask_me",
            accepted: true,
          },
        },
      },
    );
    check(
      started.status() === 201,
      "A real combined food, SNAP and electricity request is saved.",
    );
    const initial = await started.json();
    const id = initial.request.id;
    writeFileSync(
      "tmp/parent-runtime/progress-ai-request-private.json",
      JSON.stringify({ requestId: id, authUserId: fixture.authUserId }),
      { mode: 0o600 },
    );
    check(
      ["queued", "running"].includes(
        supportProgressSchema.parse(initial.progress).state,
      ) && initial.progress.canContinueAfterClosing,
      "A healthy private service reports queued or running work that can continue after closing.",
    );
    await page.close();
    const readRequest = async () => {
      const response = await context.request.get(
        `${origin}/api/parent/requests/${id}`,
      );
      check(
        response.ok(),
        "The owned request remains available during background work.",
      );
      return (await response.json()) as {
        request: SupportRequest;
        progress: unknown;
      };
    };
    stage = "planning after page closure";
    const prepared = await eventually(readRequest, (value) =>
      Boolean(value.request.plan),
    );
    check(
      prepared.request.plan?.routes.length &&
        supportProgressSchema.parse(prepared.progress).state !==
          "service_offline",
      "The real worker prepares a source-backed plan after every page is closed.",
    );
    const returned = await context.newPage();
    await returned.goto(`${origin}/support/${id}`);
    await returned
      .getByRole("heading", { name: "Ask CaseLink", exact: true })
      .waitFor();
    check(
      await returned
        .getByRole("heading", { name: "Program progress", exact: true })
        .isVisible(),
      "The parent returns to visible program progress and a family-scoped assistant.",
    );
    check(
      await returned
        .getByRole("link", { name: "Start a new SNAP application with DHS" })
        .isVisible(),
      "New SNAP requests expose the genuine guest application without waiting for an account.",
    );
    stage = "question answered after page closure";
    await returned
      .getByLabel("Your question about this request")
      .fill(
        "Has an application been sent? What do I need to do next for electricity?",
      );
    await returned
      .getByRole("checkbox", { name: /I agree to send my question/ })
      .check();
    const sent = returned.waitForResponse(
      (r) =>
        r.url().endsWith(`/requests/${id}/assistant`) &&
        r.request().method() === "POST",
    );
    await returned
      .getByRole("button", { name: "Ask CaseLink", exact: true })
      .click();
    check(
      (await sent).status() === 202,
      "The parent submits a consented real assistant question.",
    );
    await returned.close();
    const conversation = async () => {
      const response = await context.request.get(
        `${origin}/api/parent/requests/${id}/assistant`,
      );
      check(response.ok(), "The owned conversation is private and available.");
      return (await response.json()) as ParentAssistantConversation;
    };
    const answered = await eventually(conversation, (value) =>
      value.messages.some((m) => m.status === "answered"),
    );
    const answer = answered.messages.find(
      (m) => m.status === "answered",
    )?.answer;
    check(
      answer &&
        answer.paragraphs.length > 0 &&
        answer.paragraphs.every((p) => p.sourceLabel) &&
        answer.paragraphs.some(
          (p) =>
            p.sourceLabel === "Your service permission" &&
            p.text.includes(
              "does not authorize CaseLink to send information, book appointments or submit applications",
            ),
        ),
      "A real model answer persists after page closure, cites recorded sources and does not invent submission.",
    );
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/support/${id}`);
    await reopened.getByText("CaseLink AI", { exact: true }).waitFor();
    check(
      await reopened.getByLabel("Conversation about this request").isVisible(),
      "The recorded AI answer appears when the parent returns.",
    );
    stage = "identifier rejection and cancellation";
    const rejected = await context.request.post(
      `${origin}/api/parent/requests/${id}/assistant`,
      {
        headers: { Origin: origin },
        data: {
          question: "My SSN is 999-00-0000",
          consented: true,
          idempotencyKey: randomUUID(),
        },
      },
    );
    check(
      rejected.status() === 400,
      "An SSN-shaped value is rejected before chat persistence or model processing.",
    );
    const pending = await context.request.post(
      `${origin}/api/parent/requests/${id}/assistant`,
      {
        headers: { Origin: origin },
        data: {
          question: "What is happening now?",
          consented: true,
          idempotencyKey: randomUUID(),
        },
      },
    );
    check(pending.status() === 202, "A second real question can be queued.");
    const messageId = (await pending.json()).id;
    const cancelled = await context.request.delete(
      `${origin}/api/parent/requests/${id}/assistant`,
      { headers: { Origin: origin }, data: { messageId } },
    );
    check(
      cancelled.ok() &&
        (await conversation()).messages.some(
          (m) =>
            m.id === messageId &&
            m.status === "failed" &&
            /cancelled/.test(m.error ?? ""),
        ),
      "Cancelling a pending question revokes its answer lease.",
    );
    stage = "real private upload and document processing";
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage();
    const dueDate = new Date(Date.now() + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    [
      "PECO",
      "Amount due: $145.67",
      `Due date: ${dueDate}`,
      `Bill date: ${new Date().toISOString().slice(0, 10)}`,
    ].forEach((line, index) =>
      sheet.drawText(line, { x: 50, y: 750 - index * 25 }),
    );
    const upload = await context.request.post(
      `${origin}/api/parent/requests/${id}/documents`,
      {
        headers: { Origin: origin },
        multipart: {
          consent: "1",
          file: {
            name: "synthetic-peco-bill.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(await pdf.save()),
          },
        },
      },
    );
    check(
      upload.status() === 201,
      "An explicitly consented synthetic bill uploads to actual private Storage.",
    );
    const documentId = (await upload.json()).document.id;
    const processed = await eventually(readRequest, (value) =>
      Boolean(
        value.request.documents?.some(
          (d) =>
            d.id === documentId &&
            ["validated", "raw_deleted"].includes(d.status),
        ),
      ),
    );
    check(
      processed.request.documents?.some(
        (d) =>
          d.id === documentId &&
          ["validated", "raw_deleted"].includes(d.status),
      ),
      "The isolated real parser and worker process the private bill into validated facts.",
    );
    stage = "ownership and history export";
    const foreign = await context.request.get(
      `${origin}/api/parent/requests/${randomUUID()}/assistant`,
    );
    check(
      foreign.status() === 404,
      "An unowned or unknown conversation is not exposed.",
    );
    const exported = await context.request.get(
      `${origin}/api/parent/account/export`,
    );
    const exportText = await exported.text();
    const information = JSON.parse(exportText) as {
      requests: {
        id: string;
        documents: {
          id: string;
          facts: {
            field: string;
            value: unknown;
            sourceText: string;
            documentId: string;
            page: number;
          }[];
        }[];
      }[];
    };
    const facts =
      information.requests
        .find((r) => r.id === id)
        ?.documents.find((d) => d.id === documentId)?.facts ?? [];
    check(
      (
        [
          ["provider", "peco"],
          ["amountDue", 145.67],
          ["dueDate", dueDate],
        ] as const
      ).every(([field, value]) =>
        facts.some(
          (f) =>
            f.field === field &&
            f.value === value &&
            f.documentId === documentId &&
            f.page === 1 &&
            f.sourceText.length > 0,
        ),
      ),
      "The exact uploaded synthetic bill has source-backed provider, amount and date values in its owned export.",
    );
    check(
      exported.ok() &&
        exportText.includes('"assistant"') &&
        exportText.includes(messageId),
      "The information export includes retained conversation history.",
    );
    await reopened.close();
    await context.close();
    const anonymous = await browser.newContext();
    check(
      (
        await anonymous.request.get(
          `${origin}/api/parent/requests/${id}/assistant`,
        )
      ).status() === 401,
      "A separate signed-out browser cannot read the family conversation.",
    );
    await anonymous.close();
  } finally {
    await browser.close();
  }
  mkdirSync("tmp/parent-verification/connected-ai", { recursive: true });
  writeFileSync(
    "tmp/parent-verification/connected-ai/results.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        apiInterception: false,
        syntheticOnly: true,
        assertions: [...new Set(checks)],
        cleanup:
          "Exact fixture cleanup and original-account preservation must be verified separately.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.stdout.write(
    `Actual background-AI rehearsal passed (${new Set(checks).size} checks).\n`,
  );
}
void main().catch((error) => {
  process.stderr.write(
    `Connected AI rehearsal failed during ${stage}.${error instanceof assert.AssertionError ? ` ${error.message}` : ""} No household detail or credential was logged.\n`,
  );
  process.exitCode = 1;
});

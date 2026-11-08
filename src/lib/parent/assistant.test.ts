import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { assistantQuestionSchema } from "./assistant-contract";
import {
  answerParentQuestion,
  buildAssistantFacts,
  runOneParentAssistantTurn,
  type AssistantSnapshot,
} from "./assistant";
import { fixtureRequest, fixtureNow } from "./test-fixtures";
const snapshot = (
  overrides: Partial<AssistantSnapshot> = {},
): AssistantSnapshot => ({
  request: fixtureRequest(),
  runtime: { planningReady: false, assistantReady: true },
  progress: { summary: "No preparation worker is currently connected." },
  operations: [],
  reports: [],
  documents: [],
  history: [],
  ...overrides,
});
const response = (selected: unknown) =>
  Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(selected) }],
      },
    ],
    usage: { input_tokens: 400, output_tokens: 50 },
  });

describe("request-grounded parent assistant", () => {
  it("can answer from owned legacy records without sending private WIC answers to the model or erasing them", async () => {
    const request = fixtureRequest(); request.intake.needs = ["wic_continuing"];
    request.intake.childrenUnderFive = true; request.intake.pregnantOrPostpartum = false; request.mandate.recipientIds = ["wic-pa"];
    let body = "";
    await answerParentQuestion({ snapshot: snapshot({ request }), question: "What is happening with my saved request?", apiKey: "synthetic-key", now: fixtureNow, beforeCall: async () => {},
      fetcher: vi.fn(async (_url: unknown, options?: RequestInit) => { body = String(options?.body); return response({ intro: "scope", factIds: ["request-status"], actionIds: [] }); }) as typeof fetch });
    expect(body).not.toContain("childrenUnderFive"); expect(body).not.toContain("pregnantOrPostpartum");
    expect(request.intake.childrenUnderFive).toBe(true); expect(request.intake.pregnantOrPostpartum).toBe(false);
  });
  it("uses a real Responses contract but renders only selected trusted evidence and existing actions", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      bodies.push(JSON.parse(String(options?.body)));
      return response({
        intro: "scope",
        factIds: ["worker-offline", "program-philly-food"],
        actionIds: [],
      });
    }) as typeof fetch;
    const beforeCall = vi.fn(async () => {});
    const result = await answerParentQuestion({
      snapshot: snapshot(),
      question: "Is anything happening after I apply?",
      apiKey: "synthetic-key",
      now: fixtureNow,
      fetcher,
      beforeCall,
    });
    expect(beforeCall).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(bodies[0]).toMatchObject({
      model: "gpt-6.1-sol",
      store: false,
      text: { format: { strict: true } },
    });
    expect(bodies[0]).not.toHaveProperty("tools");
    expect(JSON.stringify(bodies)).not.toContain("household_id");
    expect(
      result.answer.paragraphs.some((p) =>
        p.text.includes("not currently reporting"),
      ),
    ).toBe(true);
    expect(
      result.answer.paragraphs.some(
        (p) => p.sourceUrl === "https://www.phila.gov/food/",
      ),
    ).toBe(true);
    expect(result.answer.paragraphs.at(-1)?.text).toContain("does not submit");
    expect(result.inputTokens).toBe(400);
  });
  it.each([
    "123-45-6789",
    "123456789",
    "identifierABC123456789",
    "123.45.6789",
    "123  45  6789",
    "123/45/6789",
    "１２３－４５－６７８９",
    "123\u200b-45-6789",
    "123–45–6789",
    "My password is private",
    "PIN: 9876",
    "Account number: 1234567",
    "person@example.invalid",
  ])(
    "rejects excluded information before persistence or model calls: %s",
    async (question) => {
      expect(
        assistantQuestionSchema.safeParse({
          question,
          idempotencyKey: randomUUID(),
          consented: true,
        }).success,
      ).toBe(false);
      const beforeCall = vi.fn(),
        fetcher = vi.fn();
      await expect(
        answerParentQuestion({
          snapshot: snapshot(),
          question,
          apiKey: "synthetic-key",
          now: fixtureNow,
          fetcher,
          beforeCall,
        }),
      ).rejects.toThrow("assistant_private_input");
      expect(beforeCall).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("does not collect identifiers when the parent asks why an official program needs them", () => {
    expect(
      assistantQuestionSchema.safeParse({
        question: "Why does SNAP need a Social Security number?",
        idempotencyKey: randomUUID(),
        consented: true,
      }).success,
    ).toBe(true);
  });
  it("keeps cancelled/paused status questions separate from execution and discards unconsented facts", () => {
    const request = fixtureRequest({ status: "cancelled" });
    request.intake.incomeAmount = 3125;
    request.intake.incomeFrequency = "monthly";
    request.intake.shutoffDate = "2026-11-20";
    request.mandate.allowedData = ["household"];
    const { facts } = buildAssistantFacts(snapshot({ request }), fixtureNow);
    expect(facts.find((f) => f.id === "request-status")?.text).toContain(
      "does not restart",
    );
    expect(JSON.stringify(facts)).not.toContain("3125");
    expect(JSON.stringify(facts)).not.toContain("2026-11-20");
    expect(facts.find((f) => f.id === "needs")?.text).toContain("Food");
  });
  it("keeps model conversation context within the current request version after permission or facts change", async () => {
    const request = fixtureRequest({ version: 2 });
    request.intake.incomeAmount = 3125;
    request.intake.incomeFrequency = "monthly";
    request.mandate.allowedData = ["household"];
    const statusText = buildAssistantFacts(snapshot({ request }), fixtureNow)
      .facts.find((fact) => fact.id === "request-status")!.text;
    const previous = {
      question: "What income did I provide?",
      answer: {
        intro: "Here is your saved information.",
        paragraphs: [
          { text: "Your monthly income is 3125.", sourceLabel: "Saved request" },
        ],
        actionIds: [],
      },
    };
    const fetcher = vi.fn(async () =>
      response({ intro: "status", factIds: ["request-status"], actionIds: [] }),
    ) as typeof fetch;
    await answerParentQuestion({
      snapshot: snapshot({
        request,
        history: [
          {
            ...previous, request_version: 1,
            answer: { ...previous.answer, paragraphs: [{ text: statusText, sourceLabel: "Saved request" }] },
          },
          { ...previous, request_version: 1 },
          { ...previous, request_version: 3 },
          { ...previous, request_version: "2" },
          previous,
          {
            ...previous,
            request_version: 2,
            question: "Is my request open?",
            answer: {
              ...previous.answer,
              paragraphs: [
                { text: statusText, sourceLabel: "Saved request" },
              ],
            },
          },
        ] as unknown as AssistantSnapshot["history"],
      }),
      question: "What happens next?",
      apiKey: "synthetic-key",
      now: fixtureNow,
      fetcher,
      beforeCall: async () => {},
    });
    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body));
    const context = JSON.parse(body.input[0].content);
    expect(context.history).toEqual([
      { facts: [statusText] },
    ]);
    expect(JSON.stringify(body)).not.toContain("3125");
  });
  it("uses fresh typed parent corrections without reviving facts for an earlier utility account", () => {
    const request = fixtureRequest({
      intake_need_scoped_fields: ["zip", "incomeAmount", "incomeFrequency"],
      facts: [
        {
          need: "electricity", field: "zip", value: "19103", source: "parent",
          confirmedAt: "2026-10-20T16:00:00Z", asOf: "2026-10-20",
        },
        {
          need: "electricity", field: "income", value: { amount: 3125, frequency: "monthly" },
          source: "parent", confirmedAt: "2026-10-20T16:00:00Z", asOf: "2026-10-20",
        },
        {
          need: "electricity",
          field: "utilityProvider",
          value: "other",
          source: "parent",
          confirmedAt: fixtureNow.toISOString(),
          asOf: "2026-10-25",
        },
        {
          need: "electricity",
          field: "amountDue",
          value: 45,
          source: "parent",
          confirmedAt: "2026-10-20T16:00:00Z",
          asOf: "2026-10-20",
        },
      ],
      account_changed_at: { electricity: "2026-10-24T16:00:00Z" },
    });
    const { facts } = buildAssistantFacts(snapshot({ request }), fixtureNow);
    expect(facts.find((f) => f.id === "utilities")?.text).toContain("other");
    expect(facts.some((f) => f.id === "fact-electricity-utilityProvider")).toBe(
      true,
    );
    expect(facts.some((f) => f.id === "fact-electricity-amountDue")).toBe(
      false,
    );
    expect(facts.find((f) => f.id === "fact-electricity-zip")?.text).toContain("19103");
    expect(facts.find((f) => f.id === "fact-electricity-income")?.text).toContain("3125");
  });
  it("does not replay expired intake income through current-version conversation history", async () => {
    const request = fixtureRequest({
      created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
      updated_at: fixtureNow.toISOString(),
    });
    request.intake.incomeAmount = 3125;
    request.intake.incomeFrequency = "monthly";
    const oldIncome = "Your saved income is $3125 (monthly). This is information you provided, not an agency eligibility decision.";
    let body = "";
    await answerParentQuestion({
      snapshot: snapshot({
        request,
        history: [{
          request_version: request.version,
          question: "My income was 3125. What happens next?",
          answer: {
            intro: "Saved information",
            paragraphs: [{ text: oldIncome, sourceLabel: "Your intake" }],
            actionIds: [],
          },
        }],
      }),
      question: "What happens next?",
      apiKey: "synthetic-key",
      now: fixtureNow,
      fetcher: vi.fn(async (_: unknown, options?: RequestInit) => {
        body = String(options?.body);
        return response({ intro: "status", factIds: ["request-status"], actionIds: [] });
      }) as typeof fetch,
      beforeCall: async () => {},
    });
    expect(body).not.toContain("3125");
  });
  it("attributes verified receipts and parent reports and never upgrades preparation into submission", () => {
    const { facts } = buildAssistantFacts(
      snapshot({
        operations: [
          {
            id: randomUUID(),
            need: "electricity",
            program_id: "peco-cap",
            state: "agency_submitted",
            updated_at: fixtureNow.toISOString(),
            evidence: {},
          },
          {
            id: "prepared",
            need: "electricity",
            program_id: "peco-cap",
            state: "prepared",
            updated_at: fixtureNow.toISOString(),
          },
          {
            id: "sent",
            need: "electricity",
            program_id: "peco-cap",
            state: "sent",
            updated_at: fixtureNow.toISOString(),
            evidence: {
              source: "provider_api",
              reference: "sensitive-reference-not-sent-to-model",
              recordedAt: fixtureNow.toISOString(),
            },
          },
        ],
        reports: [
          {
            need: "electricity",
            outcome: "assistance_approved",
            created_at: fixtureNow.toISOString(),
          },
        ],
      }),
      fixtureNow,
    );
    expect(facts.find((f) => f.id === "operation-prepared")?.text).toContain(
      "not a submitted",
    );
    expect(facts.find((f) => f.id === "operation-sent")?.text).toContain(
      "does not establish agency submission",
    );
    expect(facts.find((f) => f.id === "report-0")?.text).toContain(
      "not independent agency confirmation",
    );
    expect(JSON.stringify(facts)).not.toContain("sensitive-reference");
    expect(
      facts.filter((f) => f.text.includes("An agency submission was recorded")),
    ).toHaveLength(0);
  });
  it("references only supported typed necessary steps and never invents new fields or writes facts", async () => {
    const request = fixtureRequest({
      required_actions: [
        {
          id: "need-income",
          need: "electricity",
          reason: "missing_fact",
          field: "income",
          title: "What is your current income?",
          explanation: "Use the income control.",
        },
        {
          id: "bad-secret",
          need: "electricity",
          reason: "missing_fact",
          field: "ssn",
          title: "Social security",
          explanation: "Give identifier",
        },
      ],
    });
    const { facts, actionIds } = buildAssistantFacts(
      snapshot({ request }),
      fixtureNow,
    );
    expect(actionIds).toEqual(["need-income"]);
    expect(facts.some((f) => f.id === "action-bad-secret")).toBe(false);
    expect(
      buildAssistantFacts(
        snapshot({ request: { ...request, status: "cancelled" } }),
        fixtureNow,
      ).actionIds,
    ).toEqual([]);
    expect(
      buildAssistantFacts(
        snapshot({ request: { ...request, status: "closed" } }),
        fixtureNow,
      ).actionIds,
    ).toEqual([]);
    await expect(
      answerParentQuestion({
        snapshot: snapshot({ request }),
        question: "Can you send my application?",
        apiKey: "synthetic-key",
        now: fixtureNow,
        beforeCall: async () => {},
        fetcher: vi.fn(async () =>
          response({
            intro: "status",
            factIds: ["fake-approved"],
            actionIds: [],
          }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow("assistant_unverified_answer");
  });
  it("rejects free prose, refusals and incomplete responses without showing fabricated success", async () => {
    for (const output of [
      Response.json({ status: "incomplete", output: [] }),
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "unsafe" }],
          },
        ],
      }),
      response({
        intro: "status",
        factIds: [],
        actionIds: [],
        answer: "I submitted everything",
      }),
    ])
      await expect(
        answerParentQuestion({
          snapshot: snapshot(),
          question: "Did you submit it?",
          apiKey: "synthetic-key",
          now: fixtureNow,
          beforeCall: async () => {},
          fetcher: vi.fn(async () => output) as typeof fetch,
        }),
      ).rejects.toThrow();
  });
  it("makes no database or model call without a private worker key", async () => {
    const database = { query: vi.fn() };
    expect(await runOneParentAssistantTurn({ database })).toEqual({
      state: "idle",
    });
    expect(database.query).not.toHaveBeenCalled();
  });
  it("rechecks current consent/ownership in the database before the call and before saving; stale results are not shown", async () => {
    const messageId = randomUUID(),
      leaseToken = randomUUID();
    const database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("claim_assistant"))
          return {
            rows: [
              {
                value: {
                  ...snapshot(),
                  messageId,
                  leaseToken,
                  question: "What happens next?",
                },
              },
            ],
          };
        if (sql.includes("reserve_assistant"))
          return { rows: [{ value: true }] };
        if (sql.includes("finish_assistant"))
          throw new Error("authority changed");
        return { rows: [] };
      }),
    };
    const result = await runOneParentAssistantTurn({
      database,
      apiKey: "synthetic-key",
      now: () => fixtureNow,
      fetcher: vi.fn(async () =>
        response({
          intro: "status",
          factIds: ["worker-offline"],
          actionIds: [],
        }),
      ) as typeof fetch,
    });
    expect(result).toEqual({ state: "failed" });
    expect(database.query.mock.calls.map(([sql]) => sql.split("(")[0])).toEqual(
      [
        "select parent_private.parent_claim_assistant",
        "select parent_private.parent_reserve_assistant_call",
        "select parent_private.parent_finish_assistant",
        "select parent_private.parent_fail_assistant",
      ],
    );
  });
});

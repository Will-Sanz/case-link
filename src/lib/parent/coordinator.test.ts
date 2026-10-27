import { describe, it, expect, vi } from "vitest";
import { coordinateSupport } from "./coordinator";
import { fixtureIntake, fixtureMandate, fixtureNow, fixtureRequest } from "./test-fixtures";
describe("Responses support coordinator", () => {
  it("executes bounded validated program selection without inventing execution", async () => {
    const beforeCall = vi.fn(async () => {});
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({
        status: "completed",
        output:
          bodies.length === 1
            ? [
                {
                  type: "function_call",
                  name: "select_programs",
                  call_id: "synthetic-call",
                  arguments: JSON.stringify({
                    selections: [
                      { need: "electricity", programId: "peco-cap" },
                    ],
                  }),
                },
              ]
            : [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "Everything is approved!" },
                  ],
                },
              ],
      });
    }) as typeof fetch;
    const result = await coordinateSupport({
      request: fixtureRequest(),
      now: fixtureNow,
      apiKey: "synthetic-key",
      fetcher,
      beforeCall,
    });
    expect(result.modelCalls).toBe(2);
    expect(beforeCall).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toMatchObject({ model: "gpt-6.1-sol", store: false });
    expect(JSON.stringify(bodies[1])).toContain("function_call_output");
    expect(result.plan.routes.every((r) => r.state === "prepared")).toBe(true);
    expect(JSON.stringify(result.plan)).not.toContain("Everything is approved");
  });
  it("cannot expand recipient authority, tool set or budget", async () => {
    let round = 0;
    const fetcher = vi.fn(async () =>
      Response.json({
        status: "completed",
        output:
          round++ === 0
            ? [
                {
                  type: "function_call",
                  name: "select_programs",
                  call_id: "synthetic-call",
                  arguments: JSON.stringify({
                    selections: [
                      { need: "food_now", programId: "malicious-recipient" },
                    ],
                  }),
                },
              ]
            : [],
      }),
    ) as typeof fetch;
    const result = await coordinateSupport({
      request: fixtureRequest(),
      now: fixtureNow,
      apiKey: "synthetic-key",
      fetcher,
    });
    expect(result.plan.routes[0].programId).toBe("philly-food");
    const denied = vi.fn(async () => {
      throw new Error("budget");
    });
    await expect(
      coordinateSupport({
        request: fixtureRequest(),
        now: fixtureNow,
        apiKey: "synthetic-key",
        fetcher,
        beforeCall: denied,
      }),
    ).rejects.toThrow("budget");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("minimizes model context to the consented data categories", async () => {
    let body = "";
    const fetcher = vi.fn(async (_: unknown, options?: RequestInit) => {
      body = String(options?.body);
      return Response.json({ status: "completed", output: [] });
    }) as typeof fetch;
    await coordinateSupport({
      request: fixtureRequest({
        intake: fixtureIntake({
          incomeAmount: 2500,
          incomeFrequency: "monthly",
          shutoffDate: "2026-11-20",
        }),
        mandate: fixtureMandate({ allowedData: ["household"] }),
      }),
      now: fixtureNow,
      apiKey: "synthetic-key",
      fetcher,
    });
    const content = JSON.parse(JSON.parse(body).input[0].content);
    expect(content.facts).toMatchObject({ householdSize: 3, zip: "19104" });
    expect(content.facts).not.toHaveProperty("incomeAmount");
    expect(content.facts).not.toHaveProperty("shutoffDate");
    expect(body).not.toContain("2500");
  });
  it("sends only current shared and exact-need facts without exposing provenance metadata", async () => {
    let body = "";
    const request = fixtureRequest({
      created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
      updated_at: fixtureNow.toISOString(),
      intake: fixtureIntake({ incomeAmount: 3125, incomeFrequency: "monthly" }),
      intake_confirmed_at: { zip: fixtureNow.toISOString() },
      intake_need_scoped_fields: ["incomeAmount", "incomeFrequency"],
      facts: [{
        need: "electricity", field: "income", value: { amount: 2200, frequency: "monthly" },
        source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25",
      }],
    });
    await coordinateSupport({
      request, now: fixtureNow, apiKey: "synthetic-key",
      fetcher: vi.fn(async (_: unknown, options?: RequestInit) => {
        body = String(options?.body);
        return Response.json({ status: "completed", output: [] });
      }) as typeof fetch,
    });
    const content = JSON.parse(JSON.parse(body).input[0].content);
    expect(content.facts).toHaveProperty("zip", "19104");
    expect(content.facts).not.toHaveProperty("householdSize");
    expect(content.facts).not.toHaveProperty("incomeAmount");
    expect(content.needFacts).toEqual([{ need: "electricity", incomeAmount: 2200, incomeFrequency: "monthly" }]);
    expect(body).not.toContain("3125");
    expect(body).not.toContain("intake_confirmed_at");
    expect(body).not.toContain(request.household_id);
  });
});

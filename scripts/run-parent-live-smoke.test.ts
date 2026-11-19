import { describe, expect, it, vi } from "vitest";
import { NEEDS, intakeSchema } from "../src/lib/parent/domain";
import {
  parentLiveSmokeCases,
  parentLiveSmokeConfig,
  runParentLiveSmoke,
} from "./run-parent-live-smoke";

const fakeResponses = (alwaysCall = false) =>
  vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.input[0].content);
    const toolComplete = request.input.some(
      (item: { type?: string }) => item.type === "function_call_output",
    );
    return Response.json({
      model: "gpt-6.1-sol",
      status: "completed",
      usage: { input_tokens: 12, output_tokens: 8 },
      output:
        toolComplete && !alwaysCall
          ? []
          : [
              {
                type: "function_call",
                name: "select_programs",
                call_id: "synthetic-call",
                arguments: JSON.stringify({
                  selections: context.needs.map((need: string) => ({
                    need,
                    programId: context.programs.find(
                      (program: { needs: string[] }) =>
                        program.needs.includes(need),
                    ).id,
                  })),
                }),
              },
            ],
    });
  });

describe("explicitly approved direct live parent smoke", () => {
  it("ignores an ordinary configured key without both separate opt-in acknowledgements", () => {
    expect(() =>
      parentLiveSmokeConfig({ OPENAI_API_KEY: "synthetic-key" }),
    ).toThrow();
    expect(() =>
      parentLiveSmokeConfig({
        OPENAI_API_KEY: "synthetic-key",
        CASELINK_PARENT_RUN_LIVE_SMOKE: "1",
      }),
    ).toThrow();
    expect(
      parentLiveSmokeConfig({
        OPENAI_API_KEY: "synthetic-key",
        CASELINK_PARENT_RUN_LIVE_SMOKE: "1",
        CASELINK_PARENT_LIVE_SMOKE_APPROVED_EXISTING_KEY: "1",
      }),
    ).toBe("synthetic-key");
  });
  it("covers all needs, records actual tool selections and stays distinct from the full live corpus", async () => {
    for (const test of parentLiveSmokeCases()) expect(intakeSchema.safeParse(test.intake).success).toBe(true);
    expect(
      new Set(parentLiveSmokeCases().flatMap((test) => test.intake.needs)),
    ).toEqual(new Set(NEEDS));
    const fetcher = fakeResponses();
    const result = await runParentLiveSmoke("synthetic-key", fetcher);
    expect(result.failed).toBe(false);
    expect(result.results).toHaveLength(16);
    expect(result.calls).toBe(28);
    expect(fetcher).toHaveBeenCalledTimes(28);
    expect(result.inputTokens).toBe(28 * 12);
    expect(result.outputTokens).toBe(28 * 8);
    expect(result.tokenUsageComplete).toBe(true);
    expect(result.projectIdentityEstablished).toBe(false);
    expect(result.modelQualityApproval).toBe("not_established");
    expect(result.limitations).toContain("Unverified initial benefit journeys remain closed");
    expect(JSON.stringify(result)).not.toContain("synthetic-key");
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).has("OpenAI-Project"),
    ).toBe(false);
  });
  it("counts continuation calls and stops immediately at thirty without retrying", async () => {
    const fetcher = fakeResponses(true);
    const result = await runParentLiveSmoke("synthetic-key", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(30);
    expect(result.calls).toBe(30);
    expect(result.failed).toBe(true);
    expect(result.results.at(-1)?.passed).toBe(false);
  });
  it("does not mask model omissions with the server's fallback route", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: "completed",
        output: [],
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    );
    const result = await runParentLiveSmoke("synthetic-key", fetcher);
    expect(result.failed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  parentAssistantLiveCases,
  runParentAssistantLiveSmoke,
} from "./run-parent-assistant-live-smoke";
it("keeps the approved assistant validation synthetic, bounded and separate from delivery", () => {
  const cases = parentAssistantLiveCases();
  expect(cases).toHaveLength(8);
  expect(cases.map((item) => item.id)).toContain("malicious-instruction");
  expect(JSON.stringify(cases)).not.toContain("123-45-6789");
});
describe("assistant live validator transport", () => {
  it("counts each provider call and token without masking failure or logging a secret", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        model: "gpt-6.1-sol",
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 2 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  intro: "status",
                  factIds: ["progress-summary"],
                  actionIds: [],
                }),
              },
            ],
          },
        ],
      }),
    );
    const report = await runParentAssistantLiveSmoke(
      "synthetic-private-key",
      fetcher,
    );
    expect(report.failed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].passed).toBe(true);
    expect(report.results[1].passed).toBe(false);
    expect(report.calls).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(report.maximumCalls).toBe(30);
    expect(report.inputTokens).toBe(20);
    expect(report.outputTokens).toBe(4);
    expect(JSON.stringify(report)).not.toContain("synthetic-private-key");
  });
  it("stops on the first unavailable response and never retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { message: "private diagnostic" } },
        { status: 429 },
      ),
    );
    const report = await runParentAssistantLiveSmoke(
      "synthetic-private-key",
      fetcher,
    );
    expect(report.calls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(report.failed).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private diagnostic");
  });
});

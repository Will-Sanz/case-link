import { describe, expect, it, vi } from "vitest";
import { runOneParentNotification } from "./notification-runtime";
const id = "6254bc5f-8db9-4db3-8580-3be2af789716",
  token = "af0e3944-fd0e-4c27-8248-a9e1ef83b4e6";
const notice = {
  notificationId: id,
  recipient: "synthetic@example.test",
  language: "en",
  kind: "outcome",
  requestPath: "/support/d430cc02-d8d4-46cc-9900-5b397758fb16",
  idempotencyKey: id,
};
function fixture() {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          value: {
            notificationId: id,
            leaseToken: token,
            state: "leased",
            idempotencyKey: id,
          },
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ value: notice }] })
    .mockResolvedValue({ rows: [] });
  return {
    database: { query },
    apiKey: "synthetic-disabled-key",
    from: "CaseLink <updates@example.test>",
    siteOrigin: "https://parent.example.test",
    approved: true,
  };
}
describe("parent email outbox", () => {
  it("sends only a fixed generic preview after the final database consent check, with stable provider idempotency", async () => {
    const input = fixture(),
      fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: "synthetic-provider-reference" }),
        );
    expect(await runOneParentNotification({ ...input, fetcher })).toBe("sent");
    expect(input.database.query.mock.calls[1][0]).toContain(
      "parent_begin_notification",
    );
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers["Idempotency-Key"]).toBe(`caselink-parent-${id}`);
    const body = JSON.parse(options.body);
    expect(body.to).toEqual([notice.recipient]);
    expect(body.text).toContain("Sign in to view it");
    expect(JSON.stringify(body)).not.toMatch(
      /SNAP|WIC|pregnan|income|123\.45|approved|support_received/,
    );
    expect(input.database.query.mock.calls[2][1]).toEqual([
      id,
      token,
      "sent",
      "synthetic-provider-reference",
    ]);
  });
  it("does not claim unconfigured messages, send after withdrawal, or blindly repeat uncertain transport", async () => {
    const input = fixture(),
      fetcher = vi.fn();
    expect(
      await runOneParentNotification({ ...input, approved: false, fetcher }),
    ).toBe("disabled");
    expect(input.database.query).not.toHaveBeenCalled();
    input.database.query
      .mockReset()
      .mockResolvedValueOnce({
        rows: [
          {
            value: {
              notificationId: id,
              leaseToken: token,
              state: "leased",
              idempotencyKey: id,
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error("permission withdrawn"));
    await expect(
      runOneParentNotification({ ...input, fetcher }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const uncertain = fixture();
    fetcher.mockRejectedValue(new Error("timeout"));
    expect(await runOneParentNotification({ ...uncertain, fetcher })).toBe(
      "delivery_unknown",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(uncertain.database.query.mock.calls[2][1]).toEqual([
      id,
      token,
      "delivery_unknown",
      null,
    ]);
  });
});

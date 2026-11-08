import { z } from "zod";
import { canonicalProjectOrigin, isLoopbackHost } from "./project-origin";
import type { WorkerDatabase } from "./worker-runtime";

const claimSchema = z
  .object({
    notificationId: z.uuid(),
    leaseToken: z.uuid(),
    state: z.literal("leased"),
    idempotencyKey: z.uuid(),
  })
  .strict();
const noticeSchema = z
  .object({
    notificationId: z.uuid(),
    recipient: z.email(),
    language: z.enum(["en", "es"]),
    kind: z.enum(["progress", "action_required", "outcome"]),
    requestPath: z.string().regex(/^\/support\/[0-9a-f-]{36}$/),
    idempotencyKey: z.uuid(),
  })
  .strict();
const senderSchema = z
  .string()
  .max(200)
  .refine(
    (value) =>
      z.email().safeParse(value).success ||
      /^CaseLink <[^<>\r\n]+@[^<>\r\n]+>$/.test(value),
  );

/** Only fixed, private-preview-safe copy leaves the scoped outbox; no program, amount or outcome is emailed. */
export async function runOneParentNotification(input: {
  database: WorkerDatabase;
  apiKey?: string;
  from?: string;
  siteOrigin: string;
  approved: boolean;
  fetcher?: typeof fetch;
}): Promise<"disabled" | "idle" | "sent" | "failed" | "delivery_unknown"> {
  if (!input.approved || !input.apiKey || !input.from) return "disabled";
  const origin = canonicalProjectOrigin(input.siteOrigin);
  if (
    !origin ||
    isLoopbackHost(new URL(origin).hostname) ||
    !origin.startsWith("https:")
  )
    throw new Error("Notifications require an approved HTTPS parent origin.");
  const from = senderSchema.parse(input.from);
  const rpc = async (sql: string, values: unknown[]) =>
    (await input.database.query(sql, values)).rows[0]?.value;
  const raw = await rpc(
    "select parent_private.parent_claim_notification($1) value",
    [90],
  );
  if (!raw) return "idle";
  // A crashed send needs verified reconciliation, not another POST with an uncertain result.
  if (
    typeof raw === "object" &&
    "state" in raw &&
    raw.state === "delivery_unknown"
  )
    return "delivery_unknown";
  const claim = claimSchema.parse(raw);
  const begun = await rpc(
    "select parent_private.parent_begin_notification($1,$2) value",
    [claim.notificationId, claim.leaseToken],
  );
  if (!begun) return "idle";
  const notice = noticeSchema.parse(begun);
  if (
    notice.notificationId !== claim.notificationId ||
    notice.idempotencyKey !== claim.idempotencyKey
  )
    throw new Error("The notification does not match its current lease.");
  const link = `${origin}${notice.requestPath}`;
  const text =
    notice.language === "es"
      ? `Hay una actualización en tu solicitud de CaseLink. Inicia sesión para verla: ${link}\n\nPuedes cambiar tus preferencias de avisos en tu cuenta.`
      : `There is an update to your CaseLink request. Sign in to view it: ${link}\n\nYou can change your update preferences in your account.`;
  let state: "sent" | "failed" | "delivery_unknown" = "delivery_unknown",
    reference: string | null = null;
  try {
    const response = await (input.fetcher ?? fetch)(
      "https://api.resend.com/emails",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `caselink-parent-${notice.idempotencyKey}`,
        },
        body: JSON.stringify({
          from,
          to: [notice.recipient],
          subject:
            notice.language === "es"
              ? "Una actualización de CaseLink"
              : "An update from CaseLink",
          text,
        }),
      },
    );
    if (response.ok) {
      reference = z
        .object({ id: z.string().min(1).max(200) })
        .parse(await response.json()).id;
      state = "sent";
    } else if ([400, 401, 403, 404, 422, 429].includes(response.status))
      state = "failed";
  } catch {
    /* An unknown transport result cannot be treated as non-delivery. */
  }
  await rpc(
    "select parent_private.parent_finish_notification($1,$2,$3,$4) value",
    [claim.notificationId, claim.leaseToken, state, reference],
  );
  return state;
}

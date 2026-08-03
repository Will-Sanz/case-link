import "server-only";

import { createHash } from "node:crypto";
import { Resend } from "resend";
import { getEnv } from "@/lib/env";
import { buildDemoRequestMessage, type DemoRequestDetails } from "@/lib/email/demo-request-message";

const DEMO_REQUEST_RECIPIENT = "willsanz@engineering.upenn.edu";

export async function sendDemoRequestEmail(
  details: DemoRequestDetails,
): Promise<{ ok: true; emailId: string | null } | { ok: false; error: string }> {
  const env = getEnv();
  if (!env.RESEND_API_KEY?.trim()) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  const normalized = { ...details, email: details.email.toLowerCase() };
  const message = buildDemoRequestMessage(normalized, new Date());
  const idempotencyKey = `caselink-demo-${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")}`;
  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: env.RESEND_FROM_EMAIL?.trim() || "CaseLink <onboarding@resend.dev>",
      to: DEMO_REQUEST_RECIPIENT,
      replyTo: normalized.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    },
    { idempotencyKey },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, emailId: data?.id ?? null };
}

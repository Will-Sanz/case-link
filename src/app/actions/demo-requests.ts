"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { sendDemoRequestEmail } from "@/lib/email/send-demo-request";
import { getClientIpFromHeaders } from "@/lib/http/client-ip";
import { createMemorySlidingWindow } from "@/lib/rate-limit/memory-bucket";

const requestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  email: z.string().trim().email("Enter a valid work email.").max(254),
  organization: z.string().trim().min(2, "Enter your school or district.").max(160),
  role: z.string().trim().min(2, "Enter your role.").max(120),
  message: z.string().trim().max(1500).optional().default(""),
  website: z.string().max(200).optional().default(""),
});

const demoLimiter = createMemorySlidingWindow({ max: 5, windowMs: 15 * 60_000 });

export type DemoRequestState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function submitDemoRequest(
  _previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const website = formData.get("website");
  // Honeypot submissions get a neutral success response and are not validated or sent.
  if (typeof website === "string" && website.trim()) return { status: "success" };

  const parsed = requestSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    organization: formData.get("organization"),
    role: formData.get("role"),
    message: formData.get("message"),
    website,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const requestHeaders = await headers();
  const ip = getClientIpFromHeaders(requestHeaders) ?? "unknown";
  if (!demoLimiter.take(ip)) {
    return { status: "error", message: "Too many requests from this connection. Please try again in 15 minutes." };
  }

  try {
    const sent = await sendDemoRequestEmail({
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      organization: parsed.data.organization,
      role: parsed.data.role,
      message: parsed.data.message,
    });
    if (!sent.ok) {
      console.error("[demo-request] email failed", sent.error);
      return {
        status: "error",
        message: "We could not send your request. Please try again or email willsanz@engineering.upenn.edu directly.",
      };
    }
    return { status: "success" };
  } catch (error) {
    console.error("[demo-request] unavailable", error instanceof Error ? error.message : "unknown error");
    return {
      status: "error",
      message: "We could not send your request. Please try again or email willsanz@engineering.upenn.edu directly.",
    };
  }
}

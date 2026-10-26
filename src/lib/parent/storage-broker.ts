import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalProjectOrigin } from "./project-origin";

export const storagePurposeSchema = z
  .object({
    jobId: z.uuid(),
    leaseToken: z.uuid(),
    bucket: z.enum([
      "parent-documents",
      "parent-form-artifacts",
      "parent-known-forms",
    ]),
    objectPath: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.,-]+$/)
      .refine((value) => !value.includes("..")),
    mode: z.enum(["download", "upload"]),
  })
  .strict();
export type StoragePurpose = z.infer<typeof storagePurposeSchema>;
export type StorageAuthorization = StoragePurpose & {
  mediaType: string;
  maxBytes: number;
  expectedSha256?: string;
};
export type StorageBrokerPorts = {
  checkHealth?(): Promise<boolean>;
  authorize(
    purpose: StoragePurpose,
  ): Promise<Omit<StorageAuthorization, "jobId" | "leaseToken" | "mode">>;
  signDownload(bucket: string, path: string, seconds: number): Promise<string>;
  upload(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<void>;
};

const tokenSchema = storagePurposeSchema
  .extend({ mode: z.literal("upload"), expiresAt: z.number().int() })
  .strict();
function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function boundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new Error("body_limit");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("body_limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Short-lived object access; Storage's two-hour upload tokens never leave this isolated service. */
export function createStorageBroker(input: {
  secret: string;
  origin: string;
  supabaseOrigin: string;
  ports: StorageBrokerPorts;
  now?: () => number;
}) {
  if (input.secret.length < 32)
    throw new Error(
      "The broker needs a separate secret of at least 32 characters.",
    );
  const origin = canonicalProjectOrigin(input.origin),
    supabaseOrigin = canonicalProjectOrigin(input.supabaseOrigin);
  if (!origin || !supabaseOrigin)
    throw new Error(
      "The broker needs canonical project origins without credentials or URL paths.",
    );
  const now = input.now ?? Date.now;
  const sign = (payload: string) =>
    createHmac("sha256", input.secret).update(payload).digest("base64url");
  function readUploadToken(request: Request) {
    const value =
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (value.length > 2048) throw new Error("invalid_token");
    const [payload, signature, extra] = value.split(".");
    if (
      !payload ||
      !signature ||
      extra ||
      !equalSecret(signature, sign(payload))
    )
      throw new Error("invalid_token");
    const decoded = tokenSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (decoded.expiresAt <= now() || decoded.expiresAt > now() + 30000)
      throw new Error("expired_token");
    const { expiresAt: _, ...purpose } = decoded;
    void _;
    return { purpose, expiresAt: decoded.expiresAt };
  }
  async function authorize(
    purpose: StoragePurpose,
  ): Promise<StorageAuthorization> {
    const allowed = await input.ports.authorize(purpose);
    if (
      allowed.bucket !== purpose.bucket ||
      allowed.objectPath !== purpose.objectPath ||
      !Number.isInteger(allowed.maxBytes) ||
      allowed.maxBytes < 1 ||
      allowed.maxBytes > 10485760
    )
      throw new Error("invalid_authorization");
    return { ...purpose, ...allowed };
  }
  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      if (
        !equalSecret(
          request.headers.get("authorization") ?? "",
          `Bearer ${input.secret}`,
        )
      )
        return reply({ error: "Authentication required." }, 401);
      try {
        const ready = await input.ports.checkHealth?.();
        return reply({ ready: ready === true }, ready ? 200 : 503);
      } catch {
        return reply({ ready: false }, 503);
      }
    }
    if (path === "/objects" && request.method === "POST") {
      if (
        !equalSecret(
          request.headers.get("authorization") ?? "",
          `Bearer ${input.secret}`,
        )
      )
        return reply({ error: "Authentication required." }, 401);
      let purpose: StoragePurpose;
      try {
        purpose = storagePurposeSchema.parse(
          JSON.parse(Buffer.from(await boundedBytes(request, 4096)).toString()),
        );
      } catch {
        return reply({ error: "Invalid bounded object request." }, 400);
      }
      try {
        const allowed = await authorize(purpose);
        if (purpose.mode === "download") {
          const signedUrl = await input.ports.signDownload(
            purpose.bucket,
            purpose.objectPath,
            30,
          );
          const target = new URL(signedUrl);
          if (
            target.origin !== supabaseOrigin ||
            !target.pathname.startsWith("/storage/v1/object/")
          )
            throw new Error("invalid_signed_destination");
          return reply({ signedUrl });
        }
        if (
          purpose.bucket !== "parent-form-artifacts" ||
          !allowed.expectedSha256
        )
          return reply({ error: "Upload purpose unavailable." }, 403);
        const payload = Buffer.from(
          JSON.stringify({ ...purpose, expiresAt: now() + 30000 }),
        ).toString("base64url");
        return reply({
          signedUrl: `${origin}/uploads`,
          token: `${payload}.${sign(payload)}`,
        });
      } catch {
        return reply(
          { error: "Current object permission is unavailable." },
          403,
        );
      }
    }
    if (path === "/uploads" && request.method === "PUT") {
      let token: ReturnType<typeof readUploadToken>;
      try {
        token = readUploadToken(request);
      } catch {
        return reply({ error: "A current upload grant is required." }, 401);
      }
      try {
        const allowed = await authorize(token.purpose);
        const bytes = await boundedBytes(request, allowed.maxBytes);
        if (token.expiresAt <= now())
          return reply(
            { error: "The upload grant expired. Request a current grant." },
            401,
          );
        if (
          !bytes.length ||
          Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-" ||
          allowed.mediaType !== "application/pdf" ||
          !allowed.expectedSha256 ||
          createHash("sha256").update(bytes).digest("hex") !==
            allowed.expectedSha256
        )
          return reply(
            { error: "The bytes do not match the registered form." },
            400,
          );
        await authorize(token.purpose);
        await input.ports.upload(
          allowed.bucket,
          allowed.objectPath,
          bytes,
          allowed.mediaType,
        );
        return reply({ ok: true });
      } catch {
        return reply(
          {
            error:
              "The private upload could not be confirmed. Reconcile the exact object before retrying.",
          },
          409,
        );
      }
    }
    return reply({ error: "Endpoint unavailable." }, 404);
  };
}

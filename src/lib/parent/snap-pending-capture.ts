import { z } from "zod";
import { snapFinalizerIntentSchema, type SnapFinalizerIntent } from "./snap-packet-contract";
import { snapCaptureProgressSchema, type SnapCaptureProgress } from "./snap-capture-progress";

const privateMetadataSchema = z.object({
  requestId: z.uuid(), intent: snapFinalizerIntentSchema.nullable(), deadline: z.iso.datetime({ precision: 3 }).nullable(),
}).strict();
export type SnapPendingCapture = SnapCaptureProgress & z.infer<typeof privateMetadataSchema>;
export function parseSnapPendingCapture(value: unknown, scope: { requestId: string; requestVersion: number; leaseUntil: string; now: Date }): SnapPendingCapture {
  const raw = z.object({ packetId: z.unknown(), requestVersion: z.unknown(), state: z.unknown(), reason: z.unknown(), requestId: z.unknown(), intent: z.unknown(), deadline: z.unknown() }).strict().parse(value);
  const progress = snapCaptureProgressSchema.parse({ packetId: raw.packetId, requestVersion: raw.requestVersion, state: raw.state, reason: raw.reason });
  const privateMetadata = privateMetadataSchema.parse({ requestId: raw.requestId, intent: raw.intent, deadline: raw.deadline });
  if (privateMetadata.requestId !== scope.requestId || progress.requestVersion !== scope.requestVersion) throw new Error("snap_capture_scope_changed");
  if (progress.state === "unavailable") {
    if (privateMetadata.intent !== null || privateMetadata.deadline !== null) throw new Error("snap_capture_scope_changed");
  } else {
    const intent = privateMetadata.intent, deadline = Date.parse(privateMetadata.deadline ?? "");
    if (!intent || intent.requestId !== scope.requestId || intent.requestVersion !== scope.requestVersion || intent.packetId !== progress.packetId ||
      !Number.isFinite(deadline) || deadline <= scope.now.getTime() || deadline > Date.parse(scope.leaseUntil)) throw new Error("snap_capture_scope_changed");
  }
  return { ...progress, ...privateMetadata };
}

export const snapCaptureCheckResultSchema = z.object({
  packetId: z.uuid(), requestId: z.uuid(), requestVersion: z.number().int().positive().max(2147483647), contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["checked", "needs_parent", "service_unavailable"]), reason: z.string().nullable(), operationId: z.uuid().optional(),
}).strict().refine(value => snapCaptureProgressSchema.safeParse({ packetId: value.packetId, requestVersion: value.requestVersion, state: value.state, reason: value.reason }).success
  && (value.state === "checked" ? value.operationId !== undefined : value.operationId === undefined));

/** The isolated checker rechecks the lease/purpose, writes genuine bounded evidence and recovers commit uncertainty read-only. */
export type SnapCapturePreparationPort = {
  prepareCapture(input: { jobId: string; leaseToken: string; requestId: string; requestVersion: number; packetId: string; intent: SnapFinalizerIntent; deadline: string; signal: AbortSignal }): Promise<unknown>;
};

export async function runSnapCaptureCheck(port: SnapCapturePreparationPort, input: Omit<Parameters<SnapCapturePreparationPort["prepareCapture"]>[0], "signal">, timeoutMs: number): Promise<unknown> {
  if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>90000) throw new Error("snap_capture_check_unconfirmed");
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("snap_capture_check_unconfirmed")); }, timeoutMs); });
  try { return await Promise.race([port.prepareCapture({ ...input, signal: controller.signal }), timeout]); }
  finally { clearTimeout(timer); }
}

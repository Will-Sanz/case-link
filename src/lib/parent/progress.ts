import { z } from "zod";

export const supportProgressSchema = z.object({
  state: z.enum([
    "queued",
    "running",
    "needs_parent",
    "waiting",
    "paused",
    "cancelled",
    "closed",
    "failed",
    "service_offline",
  ]),
  summary: z.string().min(1).max(500),
  updatedAt: z.iso.datetime({ offset: true }),
  nextRunAt: z.iso.datetime({ offset: true }).nullable(),
  canContinueAfterClosing: z.boolean(),
});

export type SupportProgress = z.infer<typeof supportProgressSchema>;

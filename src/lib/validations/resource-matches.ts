import { z } from "zod";

export const runMatchingSchema = z.object({
  familyId: z.string().uuid(),
});

export const updateMatchStatusSchema = z.object({
  matchId: z.string().uuid(),
  familyId: z.string().uuid(),
  status: z.enum(["accepted", "dismissed"]),
});

export const addManualMatchSchema = z.object({
  familyId: z.string().uuid(),
  resourceId: z.string().uuid(),
});

export const searchResourcesSchema = z.object({
  q: z.string().max(200).optional().default(""),
});

import { z } from "zod";
import { foodDescriptionSourceSchema } from "@/lib/parent/food-assessment";
import { startFoodDescriptionRequest } from "@/lib/parent/food-description-data";
import { FoodDescriptionError } from "@/lib/parent/food-description-draft";
import { familyProfileSourceSchema } from "@/lib/parent/family-profile";
import { intakeSchema, mandateSchema, reusedZipSourceSchema } from "@/lib/parent/domain";
import {
  getSupportRequest,
  listSupportRequests,
  startSupportRequest,
} from "@/lib/parent/data";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
} from "@/lib/parent/http";
import { validateMandate } from "@/lib/parent/policy";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { getParentAuthorizationWindow } from "@/lib/parent/authorization-window";
import {
  getSupportProgress,
  listSupportProgress,
} from "@/lib/parent/progress-data";
import { SNAP_APPLICATION_NOTICE_VERSION, startSnapApplication } from "@/lib/parent/snap-application-data";
import { snapApplicationFieldsValueSchema } from "@/lib/parent/snap-application-fields";
import { snapFormTemplateIdSchema } from "@/lib/parent/snap-form-source";
import { WIC_APPLICATION_NOTICE_VERSION, startWicApplication, wicInitialIntakeSchema } from "@/lib/parent/wic-application-data";
import { wicApplicationFieldsValueSchema } from "@/lib/parent/wic-application-fields";
import { startPecoApplication, pecoInitialIntakeSchema } from "@/lib/parent/peco-application-data";
import { pecoApplicationWriteSchema } from "@/lib/parent/peco-application-snapshot";
import { startPgwApplication, pgwInitialIntakeSchema } from "@/lib/parent/pgw-application-data";
import { pgwApplicationWriteSchema } from "@/lib/parent/pgw-application-snapshot";
import { startWaterApplication, waterInitialIntakeSchema } from "@/lib/parent/water-application-data";
import { waterApplicationWriteSchema } from "@/lib/parent/water-application-snapshot";

const startSchema = z.union([
  z.object({ descriptionSource: foodDescriptionSourceSchema.optional(), intake: intakeSchema, mandate: mandateSchema, reusedZip: reusedZipSourceSchema.optional() }).strict(),
  z.object({ descriptionSource: foodDescriptionSourceSchema.optional(), kind: z.literal("snap_application"), familyProfileSource: familyProfileSourceSchema.optional(), intake: intakeSchema, mandate: mandateSchema,
    details: snapApplicationFieldsValueSchema, noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION), documentTemplateId: snapFormTemplateIdSchema.optional() }).strict(),
  z.object({ kind: z.literal("wic_application"), familyProfileSource: familyProfileSourceSchema.optional(), intake: wicInitialIntakeSchema, mandate: mandateSchema,
    details: wicApplicationFieldsValueSchema, noticeVersion: z.literal(WIC_APPLICATION_NOTICE_VERSION), subjectAuthorityDeclared: z.literal(true), reusedZip: reusedZipSourceSchema.optional() }).strict(),
  pecoApplicationWriteSchema.omit({ expectedVersion: true }).extend({ kind: z.literal("peco_application"),
    intake: pecoInitialIntakeSchema, mandate: mandateSchema, reusedZip: reusedZipSourceSchema.optional() }).strict(),
  pgwApplicationWriteSchema.omit({ expectedVersion: true }).extend({ kind: z.literal("pgw_application"),
    intake: pgwInitialIntakeSchema, mandate: mandateSchema, reusedZip: reusedZipSourceSchema.optional() }).strict(),
  waterApplicationWriteSchema.omit({ expectedVersion: true }).extend({ kind: z.literal("water_application"),
    intake: waterInitialIntakeSchema, mandate: mandateSchema, reusedZip: reusedZipSourceSchema.optional() }).strict(),
]);
const utilityStarts = { peco_application: startPecoApplication, pgw_application: startPgwApplication, water_application: startWaterApplication };

export async function GET() {
  try {
    const [requests, progress] = await Promise.all([
      listSupportRequests(),
      listSupportProgress(),
    ]);
    return parentJson({ ok: true, requests, progress });
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const authorization = await getParentAuthorizationWindow();
    const input = await readParentJson(request, 131072);
    if (input && typeof input === "object" && "kind" in input && input.kind === "snap_application" &&
      !authorization.snapApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    if (input && typeof input === "object" && "kind" in input && input.kind === "wic_application" &&
      !authorization.wicApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    if (input && typeof input === "object" && "kind" in input && input.kind === "peco_application" &&
      !authorization.pecoApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    if (input && typeof input === "object" && "kind" in input && input.kind === "pgw_application" &&
      !authorization.pgwApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    if (input && typeof input === "object" && "kind" in input && input.kind === "water_application" &&
      !authorization.waterApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    const value = startSchema.parse(input);
    if (validateMandate(value.mandate, new Date(authorization.issuedAt)))
      return parentJson(
        {
          ok: false,
          error:
            "Check the named programs and permission expiry, then start again.",
        },
        400,
      );
    const relevant = getProgramsForNeeds(value.intake.needs).map((p) => p.id);
    if (value.mandate.recipientIds.some((id) => !relevant.includes(id)))
      return parentJson(
        {
          ok: false,
          error: "Choose programs relevant to your support request.",
        },
        400,
      );
    const idempotencyKey = z
      .uuid()
      .parse(request.headers.get("idempotency-key"));
    const id = "descriptionSource" in value && value.descriptionSource ? await startFoodDescriptionRequest(value, idempotencyKey) : "kind" in value
      ? value.kind === "peco_application" || value.kind === "pgw_application" || value.kind === "water_application"
        ? await utilityStarts[value.kind](value.intake, value.mandate, { details: value.details, noticeVersion: value.noticeVersion,
          subjectAuthorityDeclared: value.subjectAuthorityDeclared, accountAuthorityDeclared: value.accountAuthorityDeclared }, idempotencyKey, value.reusedZip)
        : value.kind === "wic_application"
        ? await startWicApplication(value.intake, value.mandate, value.details, value.noticeVersion, value.subjectAuthorityDeclared, idempotencyKey, value.reusedZip, ...(value.familyProfileSource ? [value.familyProfileSource] : []))
        : await startSnapApplication(value.intake, value.mandate, value.details, value.noticeVersion, idempotencyKey,
          ...(value.documentTemplateId ? [value.familyProfileSource, value.documentTemplateId] : value.familyProfileSource ? [value.familyProfileSource] : []))
      : value.reusedZip
        ? await startSupportRequest(value.intake, value.mandate, idempotencyKey, value.reusedZip)
        : await startSupportRequest(value.intake, value.mandate, idempotencyKey);
    const [supportRequest, progress] = await Promise.all([
      getSupportRequest(id),
      getSupportProgress(id),
    ]);
    return parentJson({ ok: true, request: supportRequest, progress }, 201);
  } catch (error) {
    if (error instanceof FoodDescriptionError) return parentJson({ ok: false, error: "The optional description or selected support changed. Check your saved support or return to the guided questions." }, error.status);
    if (error instanceof Error && error.message === "parent_reuse_source_changed")
      return parentJson({ ok: false, error: "Saved routing information changed before this request was created." }, 412);
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}

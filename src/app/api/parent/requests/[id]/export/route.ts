import { readParentLocale } from "@/lib/parent/locale-server";
import { getSupportRequest } from "@/lib/parent/data";
import { renderParentSummary } from "@/lib/parent/export";
import { parentError, parentJson, uuidSchema } from "@/lib/parent/http";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const request = await getSupportRequest(
      uuidSchema.parse((await params).id),
    );
    if (!request)
      return parentJson(
        { ok: false, error: "This support request is unavailable." },
        404,
      );
    const locale = await readParentLocale();
    const pdf = await renderParentSummary(request, locale);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Language": locale,
        "Content-Disposition":
          "attachment; filename=caselink-support-summary.pdf",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return parentError(error);
  }
}

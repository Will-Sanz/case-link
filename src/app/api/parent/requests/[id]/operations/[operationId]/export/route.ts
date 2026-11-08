import { getExactOperation } from "@/lib/parent/activity";
import { renderParentPacket, type RecordedPacket } from "@/lib/parent/export";
import { parentError, parentJson, uuidSchema } from "@/lib/parent/http";
export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  try {
    const { id, operationId } = await params;
    const operation = await getExactOperation(
      uuidSchema.parse(id),
      uuidSchema.parse(operationId),
    );
    if (!operation)
      return parentJson(
        { ok: false, error: "This recorded packet is unavailable." },
        404,
      );
    const bytes = await renderParentPacket(operation as RecordedPacket);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=caselink-packet-${operationId}.pdf`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return parentError(error);
  }
}

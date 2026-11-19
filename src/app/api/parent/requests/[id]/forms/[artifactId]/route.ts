import { requireParentSession } from "@/lib/parent/auth";
import { parentError, parentJson, uuidSchema } from "@/lib/parent/http";
import { createHash } from "node:crypto";
export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  try {
    const { id, artifactId } = await params;
    const { supabase } = await requireParentSession();
    const { data: artifact, error } = await supabase
      .from("parent_form_artifacts")
      .select("id,object_path,content_sha256")
      .eq("request_id", uuidSchema.parse(id))
      .eq("id", uuidSchema.parse(artifactId))
      .eq("status", "stored")
      .maybeSingle();
    if (error) throw new Error("The prepared form could not be loaded.");
    if (!artifact)
      return parentJson(
        { ok: false, error: "This prepared form is unavailable." },
        404,
      );
    const { data, error: downloadError } = await supabase.storage
      .from("parent-form-artifacts")
      .download(artifact.object_path);
    if (downloadError || !data || data.size > 10485760)
      throw new Error("The prepared form could not be loaded.");
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      artifact.content_sha256
    )
      throw new Error("The prepared form could not be verified.");
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          "attachment; filename=caselink-prepared-form.pdf",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return parentError(error);
  }
}

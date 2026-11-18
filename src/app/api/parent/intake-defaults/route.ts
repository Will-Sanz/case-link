import { getReusableZip } from "@/lib/parent/data";
import { parentError, parentJson } from "@/lib/parent/http";

export async function GET() {
  try {
    return parentJson({ ok: true, ...await getReusableZip() });
  } catch (error) {
    return parentError(error);
  }
}

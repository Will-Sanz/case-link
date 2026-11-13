import { getReusableZip } from "@/lib/parent/data";
import { parentError, parentJson } from "@/lib/parent/http";

export async function GET() {
  try {
    return parentJson({ ok: true, zip: await getReusableZip() });
  } catch (error) {
    return parentError(error);
  }
}

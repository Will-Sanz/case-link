import { parentError, parentJson } from "@/lib/parent/http";
import { getParentPartnerDirectory } from "@/lib/parent/partner-directory";

export async function GET() {
  try {
    return parentJson({
      ok: true,
      partners: await getParentPartnerDirectory(),
    });
  } catch (error) {
    return parentError(error);
  }
}

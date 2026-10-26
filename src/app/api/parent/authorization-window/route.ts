import { getParentAuthorizationWindow } from "@/lib/parent/authorization-window";
import { parentError, parentJson } from "@/lib/parent/http";

export async function GET() {
  try {
    return parentJson({
      ok: true,
      authorization: await getParentAuthorizationWindow(),
    });
  } catch (error) {
    return parentError(error);
  }
}

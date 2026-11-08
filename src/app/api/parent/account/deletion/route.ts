import { createParentClient } from "@/lib/parent/auth";
import { getParentDeletionStatus } from "@/lib/parent/account-deletion";
import { parentError, parentJson } from "@/lib/parent/http";
export async function GET() {
  try {
    return parentJson({ ok: true, ...await getParentDeletionStatus(await createParentClient()) });
  } catch (error) {
    return parentError(error);
  }
}

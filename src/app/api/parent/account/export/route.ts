import {
  getHousehold,
  listSupportRequests,
  getSupportRequest,
} from "@/lib/parent/data";
import { parentError } from "@/lib/parent/http";
export async function GET() {
  try {
    const household = await getHousehold();
    const summaries = await listSupportRequests();
    const requests = await Promise.all(
      summaries.map((r) => getSupportRequest(r.id)),
    );
    return new Response(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), household, requests },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition":
            "attachment; filename=caselink-my-information.json",
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return parentError(error);
  }
}

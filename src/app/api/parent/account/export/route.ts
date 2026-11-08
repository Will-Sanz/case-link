import { exportParentInformation } from "@/lib/parent/data";
import { parentError } from "@/lib/parent/http";
export async function GET() {
  try {
    const information = await exportParentInformation();
    return new Response(JSON.stringify(information, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          "attachment; filename=caselink-my-information.json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return parentError(error);
  }
}

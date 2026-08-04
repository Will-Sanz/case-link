import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const requestId = randomUUID();
  return NextResponse.json(
    { status: "ok", service: "caselink" },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-CaseLink-Request-Id": requestId,
      },
    },
  );
}

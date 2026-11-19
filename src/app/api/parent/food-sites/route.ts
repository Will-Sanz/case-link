import { z } from "zod";
import { findFoodSites } from "@/lib/parent/food-sites";
import { parentJson } from "@/lib/parent/http";

export async function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip");
  if (
    !z
      .string()
      .regex(/^191\d{2}$/)
      .safeParse(zip).success
  )
    return parentJson(
      {
        ok: false,
        error: "Enter a Philadelphia ZIP code to find food nearby.",
      },
      400,
    );
  try {
    return parentJson({ ok: true, ...(await findFoodSites(zip!)) });
  } catch {
    return parentJson(
      {
        ok: false,
        error:
          "The City's food directory is unavailable right now. Use the official food and meal finder or try again.",
        sourceUrl: "https://www.phila.gov/food/",
      },
      503,
    );
  }
}

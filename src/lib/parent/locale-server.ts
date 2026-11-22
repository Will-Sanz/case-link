import "server-only";
import { cookies, headers } from "next/headers";
import { explicitParentLocale, PARENT_LOCALE_COOKIE, type ParentLocale } from "./locale";

export async function readParentLocale() {
  const chosen = explicitParentLocale((await cookies()).get(PARENT_LOCALE_COOKIE)?.value);
  if (chosen) return chosen;

  let preferred: ParentLocale = "en";
  let highestWeight = 0;
  for (const language of (await headers()).get("accept-language")?.split(",") ?? []) {
    const [tag, ...parameters] = language.trim().toLowerCase().split(";");
    const match = /^(en|es)(?:-[a-z0-9]{1,8})*$/.exec(tag.trim());
    const locale = explicitParentLocale(match?.[1]);
    const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.slice(2));
    if (locale && weight > highestWeight && weight <= 1) {
      preferred = locale;
      highestWeight = weight;
    }
  }
  return preferred;
}

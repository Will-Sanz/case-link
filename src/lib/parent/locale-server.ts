import "server-only";
import { cookies } from "next/headers";
import { PARENT_LOCALE_COOKIE, parentLocale } from "./locale";

export async function readParentLocale() {
  return parentLocale((await cookies()).get(PARENT_LOCALE_COOKIE)?.value);
}

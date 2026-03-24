import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Env vars missing or Supabase unreachable: treat as unauthenticated
  }
  if (user) {
    redirect("/families");
  }
  redirect("/login");
}

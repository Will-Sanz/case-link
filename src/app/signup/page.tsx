import { redirect } from "next/navigation";

/** Accounts are provisioned through guided district onboarding, not public signup. */
export default function SignUpPage() {
  redirect("/request-demo");
}

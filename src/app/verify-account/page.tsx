import { redirect } from "next/navigation";

// Existing bookmarks still lead to the protected workspace.
export default function VerifyAccountPage() {
  redirect("/families");
}

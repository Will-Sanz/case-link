import { redirect } from "next/navigation";

export default function NewFamilyRedirectPage() {
  redirect("/families");
}

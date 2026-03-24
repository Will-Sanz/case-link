import { redirect } from "next/navigation";

export default function DeprecatedWorkspaceRoute() {
  redirect("/families");
}

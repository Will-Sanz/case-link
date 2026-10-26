import type { Metadata } from "next";
import { ParentAccount } from "@/features/parent/account";
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};
export default function AccountPage() {
  return <ParentAccount />;
}

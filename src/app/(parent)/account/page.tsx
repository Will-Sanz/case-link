import type { Metadata } from "next";
import { ParentAccount } from "@/features/parent/account";
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ delete?: string }> }) {
  const { delete: deletion } = await searchParams;
  return <ParentAccount deletionOnly={deletion === "1"} />;
}

import type { Metadata } from "next";
import { ParentSignIn } from "@/features/parent/sign-in";
export const metadata: Metadata = { title: "Sign in" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <ParentSignIn returnTo={next} />;
}

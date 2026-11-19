import type { Metadata } from "next";
import { MySupport } from "@/features/parent/my-support";
import { readParentLocale } from "@/lib/parent/locale-server";
import { parentText } from "@/lib/parent/locale";
export async function generateMetadata(): Promise<Metadata> { return { title: parentText(await readParentLocale(), "My support") }; }
export default function MySupportPage() {
  return <MySupport />;
}

import type { Metadata } from "next";
import { MySupport } from "@/features/parent/my-support";
export const metadata: Metadata = { title: "My support" };
export default function MySupportPage() {
  return <MySupport />;
}

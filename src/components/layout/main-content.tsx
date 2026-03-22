"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

function isFullWidthPath(pathname: string): boolean {
  if (pathname === "/calendar") return true;
  if (pathname.startsWith("/families/") && pathname !== "/families" && pathname !== "/families/new") {
    return true;
  }
  return false;
}

export function MainContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const fullWidth = isFullWidthPath(pathname ?? "");

  return (
    <main
      className={cn(
        "flex-1",
        fullWidth
          ? "w-full max-w-none px-0 py-0"
          : "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        className,
      )}
    >
      {children}
    </main>
  );
}

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

/** Case assistant uses a viewport-filling flex column so the composer stays pinned while messages scroll. */
function isFamilyAssistantPath(pathname: string): boolean {
  return /^\/families\/[^/]+\/assistant\/?$/.test(pathname);
}

export function MainContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const fullWidth = isFullWidthPath(pathname);
  const assistantChatLayout = fullWidth && isFamilyAssistantPath(pathname);

  return (
    <main
      className={cn(
        "flex-1",
        fullWidth
          ? cn(
              "w-full max-w-none px-0 py-0 min-h-0",
              assistantChatLayout
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto",
            )
          : "mx-auto min-h-0 w-full max-w-5xl overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        className,
      )}
    >
      {children}
    </main>
  );
}

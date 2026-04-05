"use client";

import { useEffect } from "react";
import Link from "next/link";

const isDev = process.env.NODE_ENV === "development";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isDev) {
      console.error(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {isDev
          ? "Please try again. If this persists, check the server console and your local configuration."
          : "Please try again. If the problem continues, contact your administrator."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

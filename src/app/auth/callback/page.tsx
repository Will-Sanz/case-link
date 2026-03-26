import { Suspense } from "react";
import { AuthCallbackClient } from "@/app/auth/callback/auth-callback-client";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center bg-[#f4f6f8] px-4">
      <Suspense
        fallback={<p className="text-sm text-slate-500">Loading…</p>}
      >
        <AuthCallbackClient />
      </Suspense>
    </div>
  );
}

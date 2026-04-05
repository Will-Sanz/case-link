"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertErrorClass } from "@/lib/ui/form-classes";
import {
  safeOAuthRedirectMessage,
  safeSignInPasswordMessage,
} from "@/lib/auth/safe-client-auth-message";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const urlErrorRaw = searchParams.get("error");
  const urlError =
    urlErrorRaw ?
      (() => {
        try {
          return decodeURIComponent(urlErrorRaw);
        } catch {
          return urlErrorRaw;
        }
      })()
    : null;
  const [error, setError] = useState<string | null>(() => {
    if (urlError === "auth") {
      return "This sign-in link is invalid, expired, or was already used.";
    }
    if (urlError && urlError.length > 0) {
      return safeOAuthRedirectMessage(urlError);
    }
    return null;
  });
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signError) {
        setError(safeSignInPasswordMessage(signError.message));
        return;
      }
      router.push(nextPath.startsWith("/") ? nextPath : "/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className={alertErrorClass} role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1"
        />
        <div className="mt-2 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
          >
            Forgot Password?
          </Link>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

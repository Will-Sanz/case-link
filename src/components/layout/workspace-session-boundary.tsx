"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearLocalActionDrafts, DRAFT_LOGOUT_KEY, pruneLocalActionDrafts } from "@/lib/domain/plan/local-action-draft";

const WorkspaceUserId = createContext<string | null>(null);
export const useWorkspaceUserId = () => useContext(WorkspaceUserId);

export function WorkspaceSessionBoundary({ userId, children }: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    function leaveWorkspace() {
      setHidden(true);
      router.replace("/login");
      router.refresh();
    }
    function prune() { try { pruneLocalActionDrafts(userId); } catch { /* The editor reports unavailable recovery. */ } }
    prune();
    const timer = window.setInterval(prune, 60_000);
    const { data: { subscription } } = createSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
      if (session && session.user.id !== userId) {
        clearLocalActionDrafts();
        leaveWorkspace();
      } else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
        // Expiration retains a bounded draft for this same account to recover after signing in.
        leaveWorkspace();
      }
    });
    function onStorage(event: StorageEvent) {
      if (event.key !== DRAFT_LOGOUT_KEY) return;
      prune();
      leaveWorkspace();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", prune);
    return () => { subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", prune); };
  }, [router, userId]);
  return hidden ? null : <WorkspaceUserId value={userId}>{children}</WorkspaceUserId>;
}

import { createClient } from "@supabase/supabase-js";
import { handleStaffInvitation } from "./handler.ts";

Deno.serve(async request => {
  const url = Deno.env.get("SUPABASE_URL");
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }),
  } };
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), {
    ...options, global: { ...options.global, headers: { Authorization: request.headers.get("Authorization") ?? "" } },
  });
  const operator = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), options);
  return handleStaffInvitation(request, caller, operator);
});

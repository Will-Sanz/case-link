import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  delivery: z.enum(["email", "link"]),
}).strict();

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

async function findUser(operator: SupabaseClient, email: string): Promise<User | undefined> {
  for (let page = 1; ; page++) {
    const result = await operator.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Account lookup unavailable");
    const user = result.data.users.find(candidate => candidate.email?.toLowerCase() === email);
    if (user || result.data.users.length < 1000) return user;
  }
}

/** Only a live password-authenticated administrator may issue a staff invitation. */
export async function handleStaffInvitation(request: Request, caller: SupabaseClient, operator: SupabaseClient) {
  if (request.method !== "POST") return reply({ error: "method" }, 405);
  try {
    const auth = await caller.auth.getUser();
    if (auth.error || !auth.data.user) return reply({ error: "authentication" }, 401);
    const permission = await caller.rpc("is_app_admin");
    if (permission.error) return reply({ error: "unavailable" }, 503);
    if (permission.data !== true) return reply({ error: "permission" }, 403);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply({ error: "input" }, 400);
    const { email, delivery } = parsed.data;
    let user = await findUser(operator, email);
    if (!user) {
      const created = await operator.auth.admin.createUser({ email, email_confirm: false });
      if (created.error?.code === "email_exists") user = await findUser(operator, email);
      else if (!created.error) user = created.data.user ?? undefined;
      if (!user) return reply({ error: "unavailable" }, 503);
    }
    const account = await operator.from("app_users").select("is_active,role").eq("id", user.id).maybeSingle();
    if (account.error) return reply({ error: "unavailable" }, 503);
    if (account.data?.is_active === false) return reply({ error: "offboarded" }, 409);
    // Never expose a recovery link or change permissions for an existing account.
    if (user.email_confirmed_at) return reply({ status: "existing" });
    if (account.data?.role && account.data.role !== "case_manager") return reply({ error: "existing_role" }, 409);
    const provisioned = await operator.rpc("operator_set_user_role", {
      p_target_user_id: user.id,
      p_role: "case_manager",
      p_actor_label: `Workspace administrator ${auth.data.user.id}`,
      p_reason: `Administrator requested a staff invitation by ${delivery}`,
      p_action: "user.invited",
    });
    if (provisioned.error) return reply({ error: "permissions" }, 503);
    if (delivery === "email") {
      const sent = await operator.auth.admin.inviteUserByEmail(email);
      if (sent.error) return reply({ error: "delivery" }, sent.error.status === 429 ? 429 : 503);
      return reply({ status: "sent" });
    }
    const link = await operator.auth.admin.generateLink({ type: "invite", email });
    if (link.error || !link.data.properties?.hashed_token) return reply({ error: "delivery" }, 503);
    return reply({ status: "link", tokenHash: link.data.properties.hashed_token });
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}

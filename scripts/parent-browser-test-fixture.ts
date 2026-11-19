import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";
import { beginParentTestApproval } from "./parent-test-approval";

type Check = (condition: unknown, label: string) => asserts condition;
export type ParentBrowserFixture = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  token: string;
  requestId: string;
};

/** Two ephemeral local identities; passwords and all credentials stay in process memory. */
export async function withParentBrowserFixtures(
  check: Check,
  onStage: (value: string) => void,
  run: (fixture: {
    local: { API_URL: string; ANON_KEY: string };
    db: Client;
    fixtures: ParentBrowserFixture[];
    approvedUntil: string;
  }) => Promise<void>,
) {
  const cli = process.env.CASELINK_SUPABASE_CLI;
  check(cli, "An explicit installed Supabase CLI is required.");
  const local = JSON.parse(
    execFileSync(
      cli,
      [
        "status",
        "--workdir",
        resolve("tmp/parent-runtime"),
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15000,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      },
    ),
  ) as Record<string, string>;
  for (const [name, port, protocol] of [
    ["API_URL", "55321", "http:"],
    ["DB_URL", "55322", "postgresql:"],
  ]) {
    const url = new URL(local[name]);
    check(
      url.hostname === "127.0.0.1" &&
        url.port === port &&
        url.protocol === protocol,
      `${name} must be the exact isolated local parent service.`,
    );
  }
  check(
    local.ANON_KEY && local.SERVICE_ROLE_KEY,
    "Local fixture credentials are available.",
  );
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  };
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
  const db = new Client({
    connectionString: local.DB_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  await db.connect();
  const fixtures: {
    id: string;
    email: string;
    password: string;
    client: SupabaseClient;
    token: string;
    requestId: string;
  }[] = [];
  let approval: Awaited<ReturnType<typeof beginParentTestApproval>> | undefined;
  try {
    onStage("locking isolated test controls");
    approval = await beginParentTestApproval(db);
    const approvedUntil = approval.approvedUntil;

    onStage("creating two exact isolated synthetic identities and sessions");
    for (let index = 0; index < 2; index++) {
      const email = `parent-browser-${randomUUID()}@example.test`;
      const password = `Browser!${randomUUID()}a9`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      check(
        !created.error && created.data.user?.id,
        "The local Auth service creates the exact synthetic fixture.",
      );
      const client = createClient(local.API_URL, local.ANON_KEY, options);
      const fixture = {
        id: created.data.user.id,
        email,
        password,
        client,
        token: "",
        requestId: "",
      };
      fixtures.push(fixture);
      const signedIn = await client.auth.signInWithPassword({
        email,
        password,
      });
      check(
        !signedIn.error && signedIn.data.session?.access_token,
        "Real password authentication returns an active local session.",
      );
      fixture.token = signedIn.data.session.access_token;
      const verified = await client.auth.getUser(fixture.token);
      check(
        !verified.error && verified.data.user?.id === fixture.id,
        "Auth independently verifies the issued access token.",
      );
      const started = await client.rpc("parent_start_request", {
        p_intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
        p_mandate: fixtureMandate({
          mode: "prepare_only",
          recipientIds: ["snap-pa"],
          allowedActions: ["research", "prepare"],
          allowedData: ["household"],
          expiresAt: approvedUntil,
          maxAttempts: 1,
          maxRecipients: 1,
          bookingPreference: "ask_me",
        }),
        p_idempotency_key: randomUUID(),
      });
      check(
        !started.error && typeof started.data === "string",
        "The real parent RPC starts an owned SNAP request.",
      );
      fixture.requestId = started.data;
    }

    await run({
      local: { API_URL: local.API_URL, ANON_KEY: local.ANON_KEY },
      db,
      fixtures,
      approvedUntil,
    });
  } finally {
    let cleanupFailed = false;
    async function cleanup(action: () => Promise<unknown>) {
      try {
        await action();
      } catch {
        cleanupFailed = true;
      }
    }
    for (const fixture of fixtures) {
      await cleanup(async () => {
        check(
          /^parent-browser-[0-9a-f-]+@example\.test$/.test(fixture.email),
          "Cleanup only accepts this test's exact fixture prefix.",
        );
        const row = await db.query("select email from auth.users where id=$1", [
          fixture.id,
        ]);
        check(
          row.rows[0]?.email === fixture.email,
          "Cleanup verifies each exact identity before removal.",
        );
        const signedOut = await fixture.client.auth.signOut({ scope: "local" });
        const removed = await admin.auth.admin.deleteUser(fixture.id);
        check(
          !signedOut.error,
          "The exact fixture's real session is signed out before identity removal.",
        );
        check(
          !removed.error,
          "Only the known synthetic Auth identity is removed.",
        );
        const remaining = await db.query(
          "select (select count(*)::int from auth.users where id=$1) as users,(select count(*)::int from public.parent_accounts where id=$1) as accounts,(select count(*)::int from public.parent_requests where id=$2) as requests",
          [fixture.id, fixture.requestId || null],
        );
        check(
          remaining.rows[0].users === 0 &&
            remaining.rows[0].accounts === 0 &&
            remaining.rows[0].requests === 0,
          "The fixture identity, parent membership and request are fully removed.",
        );
      });
    }
    if (approval) await cleanup(approval.restore);
    await cleanup(() => db.end());
    if (cleanupFailed) {
      onStage(
        "restoring exact isolated controls and removing owned synthetic fixtures",
      );
      throw new Error("isolated_browser_cleanup_failed");
    }
  }
}

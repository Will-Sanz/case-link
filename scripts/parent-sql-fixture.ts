import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client, Pool, PoolClient } from "pg";

type EmbeddedPostgres = {
  exec(sql: string): Promise<unknown>;
  query(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};

/** PostgreSQL semantics only: this does not emulate Supabase Auth, Storage or concurrent connections. */
export async function createParentSqlFixture(
  modulePath: string,
): Promise<{ admin: Client; pool: Pool; version: string }> {
  if (!isAbsolute(modulePath))
    throw new Error(
      "Specify the absolute path to an independently installed PGlite module.",
    );
  const runtime = (await import(pathToFileURL(modulePath).href)) as {
    PGlite: new () => EmbeddedPostgres;
  };
  const db = new runtime.PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt(),auth.uid() to authenticated;
    create table public.app_users(id uuid primary key references auth.users(id) on delete cascade,email text,role text,is_active boolean);
    create table public.families(id uuid primary key default gen_random_uuid());
    alter table public.families enable row level security;
    grant select on public.families to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
    alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated,service_role;
    alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated,service_role;
    alter default privileges for role postgres revoke execute on functions from public;
  `);
  const migrations = [
    "20261026012733_parent_support_foundation.sql",
    "20261026014950_parent_scoped_evidence_and_outcomes.sql",
    "20261026015736_parent_verified_form_artifacts.sql",
    "20261026020521_parent_facts_and_mandate_resumption.sql",
    "20261026022658_parent_notifications_and_resume_metadata.sql",
  ];
  try {
    for (const migration of migrations)
      await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  } catch (error) {
    await db.close();
    throw error;
  }
  const query = (sql: string, parameters?: unknown[]) =>
    db.query(sql, parameters);
  const connection = { query, release() {} } as unknown as PoolClient;
  return {
    admin: {
      query,
      async connect() {},
      async end() {
        await db.close();
      },
    } as unknown as Client,
    pool: {
      async connect() {
        return connection;
      },
      async end() {},
    } as unknown as Pool,
    version: String(
      (await db.query("select version() version")).rows[0].version,
    ),
  };
}

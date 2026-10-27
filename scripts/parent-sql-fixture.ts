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
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz,created_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt(),auth.uid() to authenticated;
    create table public.app_users(id uuid primary key references auth.users(id) on delete cascade,email text,role text,is_active boolean);
    create table public.families(id uuid primary key default gen_random_uuid(),name text,created_by_id uuid references public.app_users(id));
    alter table public.families enable row level security;
    grant select on public.families to authenticated;
    create table public.resources(id uuid primary key default gen_random_uuid(),slug text not null unique,active boolean not null default true,is_demo boolean not null default false,updated_at timestamptz not null default now(),primary_contact_name text,primary_contact_email text,primary_contact_phone text,description text);
    alter table public.resources enable row level security;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
    alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated,service_role;
    alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated,service_role;
    alter default privileges for role postgres revoke execute on functions from public;
  `);
  const identifierGuard = readFileSync(
    "supabase/migrations/20260804173443_production_hardening.sql",
    "utf8",
  ).match(
    /create or replace function public\.contains_direct_identifier\(value text\)[\s\S]*?\$\$;/,
  )?.[0];
  if (!identifierGuard)
    throw new Error("The existing identifier guard was not found.");
  await db.exec(identifierGuard);
  const migrations = [
    "20261013211053_require_initial_password.sql",
    "20261026012733_parent_support_foundation.sql",
    "20261026014950_parent_scoped_evidence_and_outcomes.sql",
    "20261026015736_parent_verified_form_artifacts.sql",
    "20261026020521_parent_facts_and_mandate_resumption.sql",
    "20261026022658_parent_notifications_and_resume_metadata.sql",
    "20261026033815_parent_existing_accounts.sql",
    "20261026040540_parent_preserve_corrected_facts.sql",
    "20261026044443_parent_storage_upload_preflight.sql",
    "20261026052446_parent_authoritative_mandate_window.sql",
    "20261026155134_parent_existing_identity_cutoff.sql",
    "20261026162858_parent_runtime_progress.sql",
    "20261026163009_parent_request_assistant.sql",
    "20261026163028_parent_partner_directory.sql",
    "20261027135314_parent_operation_purpose_binding.sql",
    "20261027140357_parent_assistant_context_authority.sql",
    "20261027141312_parent_intake_source_dates.sql",
    "20261027142357_parent_intake_need_scope.sql",
    "20261027144122_parent_intake_projection.sql",
    "20261027150144_parent_packet_source_guard.sql",
    "20261027163941_parent_current_route_authority.sql",
    "20261027170820_parent_personal_act_renewal.sql",
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

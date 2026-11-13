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
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,
      owner uuid,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz default now(),version text,owner_id text,
      user_metadata jsonb,archived_at timestamptz,is_delete_marker boolean default false,is_versioned boolean default false,
      path_tokens text[] generated always as (string_to_array(name,'/')) stored,unique(bucket_id,name));
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
    "20261027172429_parent_preserve_exact_need_answers.sql",
    "20261027174125_parent_atomic_factual_answers.sql",
    "20261103220623_parent_preparation_only_forms.sql",
    "20261103224633_parent_preparation_mandate_guard.sql",
    "20261104012940_parent_snap_application_details.sql",
    "20261104021316_parent_snap_application_previews.sql",
    "20261104173842_parent_snap_submission_authorization.sql",
    "20261104190911_parent_snap_encrypted_packets.sql",
    "20261104201514_parent_storage_artifact_immutability.sql",
    "20261104212630_parent_snap_protected_capture_authority.sql",
    "20261105011520_parent_snap_capture_context.sql",
    "20261105012309_parent_snap_protected_operation_binding.sql",
    "20261105013703_parent_snap_protected_submission.sql",
    "20261105020641_parent_snap_protected_operation_projection.sql",
    "20261105021926_parent_snap_pending_capture.sql",
  "20261105025504_parent_snap_owned_review.sql",
  "20261105195436_parent_snap_direct_construction.sql",
  "20261105203600_parent_snap_direct_acquisition.sql",
  "20261105211010_parent_snap_direct_construction_acquisition.sql",
  "20261105211853_parent_snap_linked_packet_authority.sql",
  "20261105212440_parent_snap_direct_intent_recovery.sql",
  "20261105220209_parent_snap_verified_completion_route.sql",
  "20261105220445_parent_snap_linked_retention_cleanup.sql",
  "20261106051250_parent_food_journey_boundaries.sql",
  "20261106051804_parent_snap_deterministic_continuation.sql",
  "20261107024524_parent_snap_acquisition_expiry.sql",
  "20261107181301_parent_snap_direct_completion_continuation.sql",
  "20261107181433_parent_snap_delivery_intent.sql",
  "20261108010000_parent_snap_agency_next_steps.sql",
  "20261108015124_parent_deletion_after_processing_closure.sql",
  "20261109182712_parent_pilot_account_scope.sql",
  "20261113182609_parent_reusable_routing_information.sql",
  "20261113192838_parent_wic_private_application_details.sql",
    "20261113200717_parent_peco_private_application_details.sql",
    "20261113201714_parent_wic_document_boundary.sql",
    "20261113204551_parent_peco_private_document_boundary.sql",
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

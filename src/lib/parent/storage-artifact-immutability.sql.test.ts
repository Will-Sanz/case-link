import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { storageArtifactGuardReady } from "./storage-s3";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const migration = readFileSync("supabase/migrations/20261104201514_parent_storage_artifact_immutability.sql","utf8");
const preflight = migration.slice(0,migration.indexOf("create function"));
describe.skipIf(!modulePath)("immutable application Storage metadata against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  async function seed(bucket = "parent-form-artifacts") {
    const id = randomUUID(), name = `synthetic/${id}.pdf`;
    return (await fixture.admin.query(`insert into storage.objects(id,bucket_id,name,version,metadata)
      values($1,$2,$3,'synthetic-version','{"mimetype":"application/pdf","size":1}') returning *`, [id,bucket,name])).rows[0];
  }
  it.each([
    ["id", randomUUID(), "uuid"], ["bucket_id", "parent-documents", "text"], ["name", "changed.pdf", "text"],
    ["owner", randomUUID(), "uuid"], ["owner_id", randomUUID(), "text"], ["version", "changed-version", "text"],
    ["metadata", '{"size":2}', "jsonb"], ["user_metadata", '{"changed":true}', "jsonb"],
    ["created_at", "2030-01-01T00:00:00Z", "timestamptz"], ["archived_at", "2030-01-01T00:00:00Z", "timestamptz"],
    ["is_delete_marker", true, "boolean"], ["is_versioned", true, "boolean"],
  ])("rejects changing independent artifact field %s", async (column,value,type) => {
    const row = await seed();
    await expect(fixture.admin.query(`update storage.objects set ${column}=$2::${type} where id=$1`,[row.id,value])).rejects.toMatchObject({ code: "23514" });
    expect((await fixture.admin.query("select * from storage.objects where id=$1",[row.id])).rows[0]).toEqual(row);
  });
  it("allows timestamp maintenance with a stored generated path_tokens column", async () => {
    const row = await seed();
    const updated = (await fixture.admin.query("update storage.objects set updated_at='2030-01-01',last_accessed_at='2030-01-01' where id=$1 returning *",[row.id])).rows[0];
    expect(updated.path_tokens).toEqual(row.path_tokens);
    expect(updated.version).toBe(row.version);expect(updated.metadata).toEqual(row.metadata);
    expect(String(updated.updated_at)).not.toBe(String(row.updated_at));
  });
  it("preserves legacy object metadata updates while rejecting moves into the artifact bucket", async () => {
    const row = await seed("parent-documents");
    await fixture.admin.query("update storage.objects set version='legacy-update',metadata='{\"size\":2}' where id=$1",[row.id]);
    expect((await fixture.admin.query("select version from storage.objects where id=$1",[row.id])).rows[0].version).toBe("legacy-update");
    await expect(fixture.admin.query("update storage.objects set bucket_id='parent-form-artifacts' where id=$1",[row.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("still enforces immutability for an RLS-bypassing service role with table privileges", async () => {
    const row = await seed();
    await fixture.admin.query("grant usage on schema storage to service_role");
    await fixture.admin.query("grant select,update on storage.objects to service_role");
    await fixture.admin.query("set role service_role");
    try { await expect(fixture.admin.query("update storage.objects set version='changed' where id=$1",[row.id])).rejects.toMatchObject({ code: "23514" }); }
    finally { await fixture.admin.query("reset role"); }
  });
  it("checks exact enabled trigger readiness as the restricted broker and fails closed when disabled", async () => {
    expect(await storageArtifactGuardReady(fixture.admin)).toBe(false);
    await fixture.admin.query("set role parent_storage_broker");
    try { expect(await storageArtifactGuardReady(fixture.admin)).toBe(true); } finally { await fixture.admin.query("reset role"); }
    await fixture.admin.query("alter table storage.objects disable trigger parent_artifact_storage_immutable");
    try {
      await fixture.admin.query("set role parent_storage_broker");
      try { expect(await storageArtifactGuardReady(fixture.admin)).toBe(false); } finally { await fixture.admin.query("reset role"); }
    } finally { await fixture.admin.query("alter table storage.objects enable trigger parent_artifact_storage_immutable"); }
  });
  it.each(["plain", "different expression"])("rejects an unsafe generated-column contract before installation: %s", async kind => {
    await fixture.admin.query("begin");
    try {
      if (kind === "plain") await fixture.admin.query("alter table storage.objects alter column path_tokens drop expression");
      else {
        await fixture.admin.query("alter table storage.objects drop column path_tokens");
        await fixture.admin.query("alter table storage.objects add column path_tokens text[] generated always as (string_to_array(upper(name),'/')) stored");
      }
      await expect(fixture.admin.query(preflight)).rejects.toMatchObject({ code: "23514" });
    } finally { await fixture.admin.query("rollback"); }
  });
  it("accepts the actual generated-column preflight without altering data", async () => {
    await expect(fixture.admin.query(preflight)).resolves.toBeDefined();
  });
  it.each(["body", "predicate", "generated expression"])("rejects an installed but incorrect guard contract: %s", async drift => {
    await fixture.admin.query("begin");
    try {
      if (drift === "body") await fixture.admin.query("create or replace function parent_private.immutable_artifact_storage_object() returns trigger language plpgsql set search_path='' as $$begin return new;end$$");
      if (drift === "predicate") {
        await fixture.admin.query("drop trigger parent_artifact_storage_immutable on storage.objects");
        await fixture.admin.query("create trigger parent_artifact_storage_immutable before update on storage.objects for each row when(old.bucket_id='wrong-bucket') execute function parent_private.immutable_artifact_storage_object()");
      }
      if (drift === "generated expression") await fixture.admin.query("alter table storage.objects alter column path_tokens drop expression");
      await fixture.admin.query("set local role parent_storage_broker");
      expect(await storageArtifactGuardReady(fixture.admin)).toBe(false);
    } finally { await fixture.admin.query("rollback"); }
  });
  it.each(["anon","authenticated","service_role","parent_worker","parent_storage_broker","parent_retention_worker"])("grants no direct trigger-function execution to %s", async role => {
    expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.immutable_artifact_storage_object()','execute') allowed",[role])).rows[0].allowed).toBe(false);
  });
});

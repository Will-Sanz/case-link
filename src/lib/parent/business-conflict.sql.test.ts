import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const previous = "20261118043549_parent_job_plan_agency_observation_order.sql";
const migration = readFileSync("supabase/migrations/20261118043758_parent_business_conflict_http_status.sql", "utf8");
const manualConflict = /errcode\s*=\s*'40001'/gi;
const handlers = new Set(["parent_private.verify_family_profile_application(text,jsonb,jsonb,jsonb)", "parent_private.refresh_food_profile_applications()"]);
type Definition = { signature: string; definition: string; owner: number; acl: string | null; oid: number };

describe.skipIf(!modulePath)("parent business conflicts use a non-retrying transport state", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  let before: Definition[];
  async function definitions() {
    return (await fixture.admin.query<Definition>(`select p.oid, p.oid::regprocedure::text signature,
      pg_get_functiondef(p.oid) definition, p.proowner owner, p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','parent_private') and p.prokind='f' order by p.oid`)).rows;
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!, previous);
    await fixture.admin.query("create function public.school_conflict_control() returns void language plpgsql as $$begin raise exception 'school control' using errcode='40001'; end$$");
    await fixture.admin.query("create function parent_private.unreviewed_conflict_control() returns void language plpgsql as $$begin raise exception 'unreviewed control' using errcode='40001'; end$$");
    await fixture.admin.query("create function parent_private.serialization_control() returns void language plpgsql as $$begin raise serialization_failure; end$$");
    before = await definitions();
  });
  afterAll(async () => { await fixture?.admin.end(); });

  it("changes only the 31 reviewed function definitions' 52 manual SQL states, preserving owner, grants and OIDs", async () => {
    const targets = before.filter(row => row.definition.match(manualConflict) && !row.signature.includes("_control("));
    expect(targets).toHaveLength(31);
    expect(targets.reduce((sum, row) => sum + [...row.definition.matchAll(manualConflict)].length, 0)).toBe(52);
    await fixture.admin.query(migration);
    const after = await definitions();
    expect(before.filter(row => handlers.has(row.signature))).toHaveLength(2);
    expect(after).toEqual(before.map(row => {
      let definition = row.definition;
      if (targets.includes(row)) definition = definition.replace(manualConflict, "errcode='PT409'");
      if (handlers.has(row.signature)) definition = definition.replace("serialization_failure", "serialization_failure or sqlstate 'PT409'");
      return { ...row, definition };
    }));
    await expect(fixture.admin.query("select public.parent_answer_facts(gen_random_uuid(),'[]',1)")).rejects.toMatchObject({ code: "42501" });
    for (const name of ["public.school_conflict_control", "parent_private.unreviewed_conflict_control", "parent_private.serialization_control"])
      await expect(fixture.admin.query(`select ${name}()`)).rejects.toMatchObject({ code: "40001" });
  });

  it.each(["raise", "handler"])("fails closed and rolls back the whole migration when a reviewed %s count changed", async kind => {
    await fixture.admin.query("begin");
    try {
      for (const row of before) await fixture.admin.query(row.definition);
      const target = before.find(row => row.signature === (kind === "raise"
        ? "parent_answer_facts(uuid,jsonb,integer)" : "parent_private.verify_family_profile_application(text,jsonb,jsonb,jsonb)"))!;
      await fixture.admin.query(kind === "raise" ? target.definition.replace("errcode='40001'", "errcode='P0001'")
        : target.definition.replace("serialization_failure", "raise_exception"));
      const unchanged = await definitions();
      await fixture.admin.query("savepoint migration_guard");
      await expect(fixture.admin.query(migration)).rejects.toThrow(`parent conflict ${kind === "raise" ? "definition" : "handler"} changed`);
      await fixture.admin.query("rollback to savepoint migration_guard");
      expect(await definitions()).toEqual(unchanged);
    } finally { await fixture.admin.query("rollback"); }
  });
});

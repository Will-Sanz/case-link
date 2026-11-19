import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("description routing forward migration boundaries", () => {
  let before: Awaited<ReturnType<typeof createParentSqlFixture>>, after: typeof before;
  const definitions = async (fixture: typeof before) => (await fixture.admin.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
    pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.proleakproof
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','parent_private') and p.prokind='f' order by 1`)).rows;
  beforeAll(async () => { before = await createParentSqlFixture(modulePath!, "20261118235507_parent_food_description_source_fact_carry.sql"); after = await createParentSqlFixture(modulePath!, "20261119002547_parent_food_description_routing_gaps.sql"); });
  afterAll(async () => { await before?.admin.end(); await after?.admin.end(); });
  it("changes only the five reviewed definitions, retains every installed owner/ACL/security attribute without adding a function or widening existing grants", async () => {
    const old = await definitions(before), next = await definitions(after);
    expect(next.map(value => value.signature).filter(signature => !old.some(value => value.signature === signature))).toEqual([]);
    const changed: string[] = [];
    for (const prior of old) {
      const current = next.find(value => value.signature === prior.signature); expect(current).toBeDefined();
      expect({ ...current, definition: undefined }).toEqual({ ...prior, definition: undefined });
      if (current!.definition !== prior.definition) changed.push(prior.signature);
    }
    expect(changed).toEqual([
      "parent_private.food_description_carry_facts(parent_private.food_description_drafts)",
      "parent_private.food_description_needs(jsonb)",
      "parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)",
      "parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)",
      "parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)",
    ]);
    const start = next.find(value => value.signature.startsWith("parent_start_food_description_request(jsonb,jsonb,jsonb,uuid,jsonb,text,jsonb,jsonb,text)"))!.definition;
    expect(start.indexOf("if known then")).toBeLessThan(start.indexOf("d.selection->>'outOfScope'='outside_pa'"));
    expect(start).toContain("p_intake->'needs' ? 'food_now' and not(v_values ? 'foodForTwoDays')");
    expect(start).toContain("not exists(select 1 from jsonb_array_elements(d.selection->'assertions') a where a->>'questionId' in ('benefitHistory','existingIssue'))");
    expect(start).toContain("d.context is distinct from parent_private.food_description_context(d)");
    expect(start).toContain("and not(v_values ? 'benefitHistory')");
    expect(start).toContain("and v_values->>'benefitHistory'='receiving' and not(v_values ? 'existingIssue')");
    for (const name of ["parent_private.food_description_current_routing_facts", "parent_private.food_description_repeated_input", "parent_private.food_description_values"])
      expect(next.find(value => value.signature.startsWith(name + "("))!.definition).toBe(old.find(value => value.signature.startsWith(name + "("))!.definition);
  });
});

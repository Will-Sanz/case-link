import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("description source carry forward migration boundaries", () => {
  let before: Awaited<ReturnType<typeof createParentSqlFixture>>, after: typeof before;
  const definitions = async (fixture: typeof before) => (await fixture.admin.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
    pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.proleakproof
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','parent_private') and p.prokind='f' order by 1`)).rows;
  beforeAll(async () => { before = await createParentSqlFixture(modulePath!, "20261118230000_parent_food_description_unknown_resolution.sql"); after = await createParentSqlFixture(modulePath!, "20261118235507_parent_food_description_source_fact_carry.sql"); });
  afterAll(async () => { await before?.admin.end(); await after?.admin.end(); });
  it("changes only the five reviewed definitions, retains every installed owner/ACL/security attribute and adds one private helper", async () => {
    const old = await definitions(before), next = await definitions(after);
    expect(next.map(value => value.signature).filter(signature => !old.some(value => value.signature === signature))).toEqual(["parent_private.food_description_carry_facts(parent_private.food_description_drafts)"]);
    const changed: string[] = [];
    for (const prior of old) {
      const current = next.find(value => value.signature === prior.signature); expect(current).toBeDefined();
      expect({ ...current, definition: undefined }).toEqual({ ...prior, definition: undefined });
      if (current!.definition !== prior.definition) changed.push(prior.signature);
    }
    expect(changed).toEqual([
      "parent_private.food_description_current_routing_facts(parent_private.food_description_drafts)",
      "parent_private.food_description_repeated_input(parent_private.food_description_drafts,text,jsonb)",
      "parent_private.food_description_values(parent_private.food_description_drafts)",
      "parent_queue_food_description(uuid,uuid,integer,uuid,jsonb)",
      "parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)",
    ]);
    // Start, immutable attempt, reservation, purpose, account and lease bodies are exactly unchanged above.
    const queue = next.find(value => value.signature.startsWith("parent_queue_food_description("))!.definition;
    expect(queue.indexOf("description unchanged charged input")).toBeLessThan(queue.indexOf("food_description_carry_facts"));
    const resolve = next.find(value => value.signature.startsWith("parent_resolve_food_description("))!.definition;
    expect(resolve.indexOf("if v_facts=d.routing_facts and p_answers=original_answers then")).toBeLessThan(resolve.indexOf("food_description_carry_facts"));
  });
});

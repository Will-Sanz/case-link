import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("closed food journeys at PostgreSQL boundaries", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='memory-only food-boundary test',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,'food-boundary@example.invalid',now())", [owner]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      select 'uesf-benefits',action,true,true,false,'memory-only','memory-only',array['zip','householdSize','statusReference'],
      '{"zip":"household","householdSize":"household","statusReference":"household"}'::jsonb,array[]::text[],now()+interval '1 day'
      from unnest(array['submit','share','schedule','follow_up']) action`);
  });
  afterAll(async () => { await fixture?.admin.end(); });

  it.each(["food_now", "wic_new", "wic_continuing"] as const)("rejects private WIC answers at the actual intake validator for %s", async need => {
    for (const field of ["childrenUnderFive", "pregnantOrPostpartum"] as const)
      for (const value of [true, false]) await expect(fixture.admin.query("select parent_private.validate_intake($1)", [JSON.stringify({ ...fixtureIntake({ needs: [need] }), [field]: value })])).rejects.toThrow();
    await expect(fixture.admin.query("select parent_private.validate_intake($1)", [JSON.stringify(fixtureIntake({ needs: [need] }))])).resolves.toBeTruthy();
  });

  async function start(need: "snap_new" | "snap_renewal" | "snap_pending" | "snap_problem" | "wic_new" | "wic_continuing") {
    await fixture.admin.query("set role authenticated");
    try {
      const previous = await fixture.admin.query("select id from public.parent_requests where status='active'");
      for (const row of previous.rows) await fixture.admin.query("select public.parent_control_request($1,'cancel')", [row.id]);
      return (await fixture.admin.query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: [need], utilityProviders: [] })),
        JSON.stringify(fixtureMandate({ recipientIds: ["uesf-benefits"], bookingPreference: "any_weekday", expiresAt: new Date(Date.now() + 3600000).toISOString() })), randomUUID()])).rows[0].id;
    } finally { await fixture.admin.query("reset role"); }
  }
  it.each(["snap_renewal", "snap_pending", "snap_problem", "wic_new", "wic_continuing"] as const)("denies initial %s operations despite a verified generic capability", async need => {
    const id = await start(need);
    for (const action of ["submit", "share", "schedule"])
      expect((await fixture.admin.query("select parent_private.operation_allowed($1,1,'uesf-benefits',$2,array['household'],array[]::uuid[],$3,$4) allowed", [id, action, JSON.stringify({ zip: "19104", householdSize: 3 }), need])).rows[0].allowed).toBe(false);
  });
  it("retains the existing new-SNAP authority path and all its normal checks", async () => {
    const id = await start("snap_new");
    expect((await fixture.admin.query("select parent_private.operation_allowed($1,1,'uesf-benefits','share',array['household'],array[]::uuid[],$2,'snap_new') allowed", [id, JSON.stringify({ zip: "19104", householdSize: 3 })])).rows[0].allowed).toBe(true);
    expect((await fixture.admin.query("select parent_private.operation_allowed($1,2,'uesf-benefits','share',array['household'],array[]::uuid[],$2,'snap_new') allowed", [id, JSON.stringify({ zip: "19104", householdSize: 3 })])).rows[0].allowed).toBe(false);
  });
});

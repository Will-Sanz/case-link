import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";

const databaseUrl = process.env.CASELINK_DB_SECURITY_TEST_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const parsedUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname)
  && process.env.CASELINK_DB_SECURITY_TEST_ALLOW_REMOTE !== "1"
) {
  throw new Error("Refusing to run destructive security fixtures against a remote database.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 20 });
const admin = new Client({ connectionString: databaseUrl });
const userA = randomUUID();
const userB = randomUUID();
const unprovisionedUser = randomUUID();
const familyA = randomUUID();
const familyB = randomUUID();
const planA = randomUUID();
const planB = randomUUID();
const stepA = randomUUID();
const stepB = randomUUID();
const actionA = randomUUID();
const actionB = randomUUID();
const resourceId = randomUUID();
const matchId = randomUUID();

async function asUser<T>(
  userId: string,
  run: (client: PoolClient) => Promise<T>,
  aal: "aal1" | "aal2" = "aal1",
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal }),
    ]);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function expectDbError(run: () => Promise<unknown>, label: string) {
  await assert.rejects(run, label);
}

async function setup() {
  await admin.connect();
  if (["127.0.0.1", "localhost"].includes(parsedUrl.hostname)) {
    await admin.query(
      `delete from public.families where created_by_id in (
         select id from auth.users where email like 'case-a-%@example.test'
            or email like 'case-b-%@example.test'
            or email like 'case-unprovisioned-%@example.test'
       )`,
    );
    await admin.query(
      `delete from auth.users where email like 'case-a-%@example.test'
         or email like 'case-b-%@example.test'
         or email like 'case-unprovisioned-%@example.test'`,
    );
    await admin.query("delete from public.resources where slug like 'security-%'");
    await admin.query("delete from private.ai_rate_counters");
  }
  await admin.query(
    `insert into auth.users (id, aud, role, email, created_at, updated_at)
     values ($1, 'authenticated', 'authenticated', $2, now(), now()),
            ($3, 'authenticated', 'authenticated', $4, now(), now()),
            ($5, 'authenticated', 'authenticated', $6, now(), now())`,
    [
      userA,
      `case-a-${userA}@example.test`,
      userB,
      `case-b-${userB}@example.test`,
      unprovisionedUser,
      `case-unprovisioned-${unprovisionedUser}@example.test`,
    ],
  );
  await admin.query(
    `insert into public.app_users (id, email, role)
     values ($1, $2, 'case_manager'), ($3, $4, 'case_manager')`,
    [userA, `case-a-${userA}@example.test`, userB, `case-b-${userB}@example.test`],
  );
  await admin.query(
    `insert into public.families (id, name, created_by_id)
     values ($1, 'Family Alpha', $2), ($3, 'Family Beta', $4)`,
    [familyA, userA, familyB, userB],
  );
  await admin.query(
    `insert into public.plans (id, family_id, version, generation_source)
     values ($1, $2, 1, 'rules'), ($3, $4, 1, 'rules')`,
    [planA, familyA, planB, familyB],
  );
  await admin.query(
    `insert into public.plan_steps (id, plan_id, phase, title, description, sort_order, details)
     values ($1, $2, '30', 'Alpha step', 'Alpha description', 0, '{"expected_outcome":"Alpha outcome"}'::jsonb),
            ($3, $4, '30', 'Beta step', 'Beta description', 0, '{"expected_outcome":"Beta outcome"}'::jsonb)`,
    [stepA, planA, stepB, planB],
  );
  await admin.query(
    `insert into public.plan_step_action_items (
       id, plan_step_id, title, week_index, target_date, sort_order
     ) values ($1, $2, 'Alpha action', 1, '2026-08-10', 0),
              ($3, $4, 'Beta action', 1, '2026-08-10', 0)`,
    [actionA, stepA, actionB, stepB],
  );
  await admin.query(
    `insert into public.resources (
       id, slug, import_key, office_or_department, program_name
     ) values ($1, $2, $3, 'Test office', 'Test resource')`,
    [resourceId, `security-${resourceId}`, `security-${resourceId}`],
  );
  await admin.query(
    `insert into public.resource_matches (
       id, family_id, resource_id, match_reason, score
     ) values ($1, $2, $3, 'Housing match', 10)`,
    [matchId, familyA, resourceId],
  );
}

async function run() {
  await setup();

  await asUser(userA, (client) => client.query("select public.ensure_app_user()"));
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query("select public.ensure_app_user()")),
    "authenticated users cannot provision their own application role",
  );
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query(
      `select public.create_family_intake(
         'Unprovisioned family', null, 'medium', null,
         '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
    )),
    "unprovisioned auth accounts cannot create workspace data",
  );
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query(
      "select public.consume_ai_budget('chat', 1)",
    )),
    "unprovisioned auth accounts cannot consume the deployment AI budget",
  );

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.app_users set role = 'admin' where id = $1",
      [userA],
    )),
    "case managers cannot promote themselves",
  );
  await asUser(userA, (client) => client.query(
    "update public.app_users set display_name = 'Case Manager' where id = $1",
    [userA],
  ));
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.app_users (id, email, role) values ($1, 'forged@example.test', 'admin')",
      [randomUUID()],
    )),
    "browser sessions cannot insert authorization profiles",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.operator_set_user_role($1, 'admin', 'forged user', 'unauthorized role change', 'user.role_changed')",
      [userA],
    )),
    "browser sessions cannot execute operator role changes",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.operator_set_family_assignment($1, $2, true, 'forged user', 'unauthorized assignment')",
      [familyB, userA],
    )),
    "browser sessions cannot execute operator assignments",
  );
  const operator = await pool.connect();
  try {
    await operator.query("begin");
    await operator.query("set local role service_role");
    await operator.query(
      "select public.operator_set_user_role($1, 'admin', 'security test', 'verify atomic role audit', 'user.role_changed')",
      [userB],
    );
    const assigned = await operator.query<{ operator_set_family_assignment: boolean }>(
      "select public.operator_set_family_assignment($1, $2, true, 'security test', 'verify atomic assignment audit')",
      [familyB, userA],
    );
    assert.equal(assigned.rows[0].operator_set_family_assignment, true);
    await operator.query("commit");
  } catch (error) {
    await operator.query("rollback");
    throw error;
  } finally {
    operator.release();
  }
  const passwordOnlyAdminAccess = await asUser(userB, (client) => client.query(
    "select count(*)::int as count from public.families where id = $1",
    [familyA],
  ));
  assert.equal(passwordOnlyAdminAccess.rows[0].count, 0);
  const mfaAdminAccess = await asUser(userB, (client) => client.query(
    "select count(*)::int as count from public.families where id = $1",
    [familyA],
  ), "aal2");
  assert.equal(mfaAdminAccess.rows[0].count, 1);
  await admin.query(
    "select public.operator_set_user_role($1, 'case_manager', 'security test', 'restore fixture role safely', 'user.role_changed')",
    [userB],
  );
  const roleAudit = await admin.query(
    `select count(*)::int as count from public.security_audit_log
     where target_user_id = $1 and action = 'user.role_changed'`,
    [userB],
  );
  assert.equal(roleAudit.rows[0].count, 2);
  const assignmentAudit = await admin.query(
    `select count(*)::int as count from public.security_audit_log
     where target_user_id = $1 and action = 'family.assignment_added'
       and details->>'family_id' = $2`,
    [userA, familyB],
  );
  assert.equal(assignmentAudit.rows[0].count, 1);
  const privilegedDirectDml = await admin.query(
    `select count(*)::int as count
     from information_schema.role_table_grants
     where grantee = 'service_role'
       and table_schema = 'public'
       and table_name in ('app_users', 'family_case_managers', 'activity_log', 'security_audit_log')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
  );
  assert.equal(privilegedDirectDml.rows[0].count, 0);
  const browserSchemaCreate = await admin.query<{ can_create: boolean }>(
    "select has_schema_privilege('authenticated', 'public', 'CREATE') as can_create",
  );
  assert.equal(browserSchemaCreate.rows[0].can_create, false);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.families set created_by_id = $1 where id = $2",
      [userA, familyB],
    )),
    "ownership cannot be changed directly",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.families (name, created_by_id) values ('Direct family', $1)",
      [userA],
    )),
    "family intake cannot bypass its transaction",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.plan_steps set title = 'Contact student@example.test' where id = $1",
      [stepA],
    )),
    "direct step updates cannot bypass identifier DLP",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.plan_step_action_items set description = 'Call 215-555-0100' where id = $1",
      [actionA],
    )),
    "direct action-item updates cannot bypass identifier DLP",
  );

  const created = await asUser(userA, (client) => client.query<{ create_family_intake: string }>(
    `select public.create_family_intake(
       'Family Gamma', null, 'medium', null,
       '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
     )`,
  ));
  assert.match(created.rows[0].create_family_intake, /^[0-9a-f-]{36}$/);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `select public.create_family_intake(
         'Family Unsafe', 'email student@example.test', 'medium', null,
         '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
    )),
    "database DLP rejects obvious identifiers",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `select public.create_family_intake(
         'Family Atomic', null, 'medium', null,
         $1::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
      [JSON.stringify([{ label: "Valid goal" }, { label: "x".repeat(201) }])],
    )),
    "invalid child rows roll back the full intake",
  );
  const partialIntake = await admin.query(
    "select count(*)::int as count from public.families where name = 'Family Atomic'",
  );
  assert.equal(partialIntake.rows[0].count, 0);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.activity_log (family_id, action)
       values ($1, 'plan.reviewed')`,
      [familyA],
    )),
    "activity rows cannot be fabricated",
  );
  await asUser(userA, (client) => client.query(
    "select public.record_activity_event($1, 'family.workflow_step_viewed', 'plan', $2)",
    [familyA, planA],
  ));
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'family.workflow_step_viewed', 'plan', $2, $3::jsonb)",
      [familyA, planA, JSON.stringify({ note: "Email student@example.test" })],
    )),
    "product timeline metadata cannot bypass identifier DLP",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'forged.action', 'plan', $2)",
      [familyA, planA],
    )),
    "activity taxonomy is allowlisted",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'step.refined', 'plan_step', $2)",
      [familyA, stepA],
    )),
    "retired product timeline actions cannot be fabricated",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'plan.reviewed', 'plan', $2)",
      [familyA, planA],
    )),
    "consequential database-owned events cannot be fabricated through the product timeline RPC",
  );

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.update_resource_match($1, $2, 'link', null::public.match_status, $3)",
      [familyA, matchId, stepB],
    )),
    "cross-family resource links fail",
  );
  const linked = await asUser(userA, (client) => client.query<{ update_resource_match: boolean }>(
    "select public.update_resource_match($1, $2, 'link', null::public.match_status, $3)",
    [familyA, matchId, stepA],
  ));
  assert.equal(linked.rows[0].update_resource_match, true);
  const accepted = await asUser(userA, (client) => client.query<{ update_resource_match: boolean }>(
    "select public.update_resource_match($1, $2, 'status', 'accepted', null)",
    [familyA, matchId],
  ));
  assert.equal(accepted.rows[0].update_resource_match, true);
  await asUser(userA, (client) => client.query(
    "select public.update_resource_match($1, $2, 'unlink', null::public.match_status, null)",
    [familyA, matchId],
  ));
  const matchEvents = await admin.query(
    `select count(*)::int as count from public.activity_log
     where family_id = $1 and entity_id = $2::text and source = 'database'
       and action in ('matching.linked_to_step', 'matching.accepted', 'matching.unlinked_from_step')`,
    [familyA, matchId],
  );
  assert.equal(matchEvents.rows[0].count, 3);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.resource_matches set status = 'dismissed' where id = $1",
      [matchId],
    )),
    "resource-match mutations cannot bypass their audited RPC",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.resource_matches set family_id = $1 where id = $2",
      [familyB, matchId],
    )),
    "resource-match ownership remains immutable even when the user can access both families",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.resource_matches (family_id, resource_id, match_reason, score)
       values ($1, $2, 'Direct suggestion', 10)`,
      [familyB, resourceId],
    )),
    "resource suggestions cannot bypass their transactional RPC",
  );
  const suggestions = [{
    resource_id: resourceId,
    match_reason: "Verified housing suggestion",
    score: 20,
  }];
  const replaced = await asUser(userA, (client) => client.query<{
    replace_suggested_resource_matches: number;
  }>(
    "select public.replace_suggested_resource_matches($1, $2::jsonb, 1)",
    [familyB, JSON.stringify(suggestions)],
  ));
  assert.equal(replaced.rows[0].replace_suggested_resource_matches, 1);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.replace_suggested_resource_matches($1, $2::jsonb, 2)",
      [familyB, JSON.stringify([...suggestions, { ...suggestions[0], resource_id: randomUUID() }])],
    )),
    "an invalid resource suggestion rolls back replacement and its event",
  );
  const replacementEvidence = await admin.query(
    `select
       (select count(*)::int from public.resource_matches
        where family_id = $1 and resource_id = $2 and status = 'suggested') as matches,
       (select count(*)::int from public.activity_log
        where family_id = $1 and action = 'matching.run' and source = 'database') as events`,
    [familyB, resourceId],
  );
  assert.equal(replacementEvidence.rows[0].matches, 1);
  assert.equal(replacementEvidence.rows[0].events, 1);
  const manualMatch = await asUser(userA, (client) => client.query<{
    add_manual_resource_match: string;
  }>(
    "select public.add_manual_resource_match($1, $2)",
    [familyB, resourceId],
  ));
  assert.match(manualMatch.rows[0].add_manual_resource_match, /^[0-9a-f-]{36}$/);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "delete from public.resource_matches where id = $1",
      [manualMatch.rows[0].add_manual_resource_match],
    )),
    "resource matches cannot be deleted outside a transactional operation",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.plan_step_activity (
         plan_step_id, family_id, actor_user_id, action
       ) values ($1, $2, $3, 'step.refined')`,
      [stepA, familyA, userA],
    )),
    "step activity cannot be inserted directly",
  );
  const reviewed = await asUser(userA, (client) => client.query<{ mark_plan_reviewed: string }>(
    "select public.mark_plan_reviewed($1, $2)",
    [familyA, planA],
  ));
  assert.ok(Number.isFinite(new Date(String(reviewed.rows[0].mark_plan_reviewed)).getTime()));
  await asUser(userA, (client) => client.query(
    "update public.plans set summary = 'Revised plan summary' where id = $1",
    [planA],
  ));
  const reviewAfterPlanEdit = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterPlanEdit.rows[0].reviewed, false);
  await asUser(userA, (client) => client.query(
    "select public.mark_plan_reviewed($1, $2)",
    [familyA, planA],
  ));
  await asUser(userA, (client) => client.query(
    "update public.plan_steps set workflow_data = '{\"documents_received\":true}'::jsonb where id = $1",
    [stepA],
  ));
  const reviewAfterProgress = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterProgress.rows[0].reviewed, true);
  await asUser(userA, (client) => client.query(
    "update public.plan_steps set title = 'Revised alpha step' where id = $1",
    [stepA],
  ));
  const reviewAfterMaterialEdit = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterMaterialEdit.rows[0].reviewed, false);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.plan_steps (plan_id, phase, title, description, sort_order)
       values ($1, '30', 'Bypass step', '', 2)`,
      [planA],
    )),
    "manual plan steps cannot bypass their atomic RPC",
  );
  const manualStep = await asUser(userA, (client) => client.query<{ create_manual_plan_step: string }>(
    `select public.create_manual_plan_step(
       $1, $2, '30', 'Manual housing action', 'Contact the approved office',
       '2026-08-20'::date, '{"owner":"case_manager","stage_goal":"Housing stability"}'::jsonb
     )`,
    [familyA, planA],
  ));
  const manualStepId = manualStep.rows[0].create_manual_plan_step;
  const manualStepEvidence = await admin.query(
    `select
       (select count(*)::int from public.plan_step_action_items where plan_step_id = $1) as actions,
       (select count(*)::int from public.activity_log where entity_id = $1::text and action = 'step.added') as events`,
    [manualStepId],
  );
  assert.equal(manualStepEvidence.rows[0].actions, 1);
  assert.equal(manualStepEvidence.rows[0].events, 1);
  const manualDeleted = await asUser(userA, (client) => client.query<{ delete_plan_step: boolean }>(
    "select public.delete_plan_step($1, $2)",
    [familyA, manualStepId],
  ));
  assert.equal(manualDeleted.rows[0].delete_plan_step, true);
  const manualDeleteEvidence = await admin.query(
    "select count(*)::int as count from public.activity_log where entity_id = $1 and action = 'step.deleted'",
    [manualStepId],
  );
  assert.equal(manualDeleteEvidence.rows[0].count, 1);

  const unrelatedArchive = await asUser(userA, (client) =>
    client.query<{ archive_family: boolean }>("select public.archive_family($1)", [familyB]));
  assert.equal(unrelatedArchive.rows[0].archive_family, false);
  const archived = await asUser(userA, (client) => client.query<{ archive_family: boolean }>(
    "select public.archive_family($1)",
    [familyA],
  ));
  assert.equal(archived.rows[0].archive_family, true);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.case_notes (family_id, author_id, body) values ($1, $2, 'Direct note')",
      [familyA, userA],
    )),
    "case notes are append-only through the audited RPC",
  );
  const note = await asUser(userA, (client) => client.query<{ add_case_note: string }>(
    "select public.add_case_note($1, 'Privacy-safe progress update')",
    [familyA],
  ));
  const noteAudit = await admin.query(
    `select count(*)::int as count from public.activity_log
     where family_id = $1 and action = 'note.added' and entity_id = $2`,
    [familyA, note.rows[0].add_case_note],
  );
  assert.equal(noteAudit.rows[0].count, 1);

  const invalidGeneratedStep = [{
    phase: "30",
    title: "Valid step",
    description: "Valid description",
    sort_order: 0,
    priority: "medium",
    details: { expected_outcome: "A safe outcome" },
    action_items: [{
      title: "",
      description: null,
      week_index: 1,
      target_date: "2026-08-10",
      sort_order: 0,
    }],
  }];
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.create_plan_with_steps($1, 'rules', null, $2::jsonb)",
      [familyB, JSON.stringify(invalidGeneratedStep)],
    )),
    "invalid generated children roll back the plan and audit event",
  );
  const partialPlan = await admin.query(
    "select count(*)::int as count from public.plans where family_id = $1 and version = 2",
    [familyB],
  );
  assert.equal(partialPlan.rows[0].count, 0);

  const initialGenerationState = {
    v: 1,
    status: "running",
    pending_phase: "30",
    planning_brief: "Housing support and benefits navigation",
    phases_complete: { "30": false, "60": false, "90": false },
    models_used: [],
    stage_timings_ms: {},
    ai_mode: "fast",
  };
  const stagedStarts = await Promise.all(
    Array.from({ length: 6 }, () => asUser(userB, async (client) => {
      const result = await client.query<{
        start_staged_plan_generation: { planId: string; existing: boolean };
      }>(
        "select public.start_staged_plan_generation($1, $2::jsonb)",
        [familyB, JSON.stringify(initialGenerationState)],
      );
      return result.rows[0].start_staged_plan_generation;
    })),
  );
  assert.equal(new Set(stagedStarts.map((result) => result.planId)).size, 1);
  assert.equal(stagedStarts.filter((result) => !result.existing).length, 1);
  const stagedPlanId = stagedStarts[0].planId;

  const nextGenerationState = {
    ...initialGenerationState,
    pending_phase: "60",
    phases_complete: { ...initialGenerationState.phases_complete, "30": true },
    models_used: ["gpt-test"],
    stage_timings_ms: { "30": 25 },
  };
  const invalidPhase = [{
    phase: "30",
    title: "Initial housing outreach",
    description: "Contact the approved program.",
    sort_order: 0,
    priority: "medium",
    details: { expected_outcome: "Outreach is completed." },
    action_items: [{
      title: "",
      description: null,
      week_index: 1,
      target_date: "2026-08-10",
      sort_order: 0,
    }],
  }];
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.append_staged_plan_phase($1, $2, '30', $3::jsonb, $4::jsonb, 'gpt-test', 25)",
      [familyB, stagedPlanId, JSON.stringify(invalidPhase), JSON.stringify(nextGenerationState)],
    )),
    "invalid staged children roll back the complete phase transition",
  );
  const rolledBackPhase = await admin.query(
    `select
       (select count(*)::int from public.plan_steps where plan_id = $1 and phase = '30') as steps,
       generation_state->>'pending_phase' as pending_phase
     from public.plans where id = $1`,
    [stagedPlanId],
  );
  assert.equal(rolledBackPhase.rows[0].steps, 0);
  assert.equal(rolledBackPhase.rows[0].pending_phase, "30");

  const validPhase = [{
    ...invalidPhase[0],
    action_items: [{ ...invalidPhase[0].action_items[0], title: "Call the housing program" }],
  }];
  const appended = await asUser(userB, (client) => client.query<{ append_staged_plan_phase: boolean }>(
    "select public.append_staged_plan_phase($1, $2, '30', $3::jsonb, $4::jsonb, 'gpt-test', 25)",
    [familyB, stagedPlanId, JSON.stringify(validPhase), JSON.stringify(nextGenerationState)],
  ));
  assert.equal(appended.rows[0].append_staged_plan_phase, true);
  const committedPhase = await admin.query(
    `select
       (select count(*)::int from public.plan_steps where plan_id = $1 and phase = '30') as steps,
       (select count(*)::int from public.activity_log where family_id = $2 and entity_id = $1::text and action = 'plan.stage_generated') as events,
       generation_state->>'pending_phase' as pending_phase
     from public.plans where id = $1`,
    [stagedPlanId, familyB],
  );
  assert.equal(committedPhase.rows[0].steps, 1);
  assert.equal(committedPhase.rows[0].events, 1);
  assert.equal(committedPhase.rows[0].pending_phase, "60");
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.update_staged_plan_state($1, $2, $3::jsonb, 'gpt-test', 'plan.generation_finished', '{}'::jsonb)",
      [familyB, stagedPlanId, JSON.stringify(nextGenerationState)],
    )),
    "generation audit events must match the persisted state",
  );
  const failedGenerationState = {
    ...nextGenerationState,
    status: "failed",
    error: "Provider unavailable",
  };
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.update_staged_plan_state($1, $2, $3::jsonb, 'gpt-test', 'plan.generation_failed', $4::jsonb)",
      [
        familyB,
        stagedPlanId,
        JSON.stringify(failedGenerationState),
        JSON.stringify({ category: "Call 215-555-0100" }),
      ],
    )),
    "generation event metadata cannot bypass identifier DLP",
  );
  const failedStateUpdated = await asUser(userB, (client) => client.query<{
    update_staged_plan_state: boolean;
  }>(
    "select public.update_staged_plan_state($1, $2, $3::jsonb, 'gpt-test', 'plan.generation_failed', '{\"category\":\"provider\"}'::jsonb)",
    [familyB, stagedPlanId, JSON.stringify(failedGenerationState)],
  ));
  assert.equal(failedStateUpdated.rows[0].update_staged_plan_state, true);
  const failedStateEvidence = await admin.query(
    `select
       generation_state->>'status' as status,
       (select count(*)::int from public.activity_log
        where family_id = $2 and entity_id = $1::uuid::text and action = 'plan.generation_failed') as events
     from public.plans where id = $1::uuid`,
    [stagedPlanId, familyB],
  );
  assert.equal(failedStateEvidence.rows[0].status, "failed");
  assert.equal(failedStateEvidence.rows[0].events, 1);
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      `update public.plans
       set client_display = '{"reviewedAt":"2026-08-04T00:00:00Z","reviewedById":"00000000-0000-0000-0000-000000000000"}'::jsonb
       where id = $1`,
      [stagedPlanId],
    )),
    "reviewed-plan evidence cannot be forged through direct plan updates",
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "update public.plans set generation_state = '{\"status\":\"complete\"}'::jsonb where id = $1",
      [stagedPlanId],
    )),
    "generation state cannot be forged through direct plan updates",
  );
  const stagedChild = await admin.query<{ step_id: string; action_id: string }>(
    `select step.id as step_id, item.id as action_id
     from public.plan_steps step
     join public.plan_step_action_items item on item.plan_step_id = step.id
     where step.plan_id = $1 limit 1`,
    [stagedPlanId],
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      `update public.plan_steps
       set workflow_data = '{"outcome_notes":"Email student@example.test"}'::jsonb
       where id = $1`,
      [stagedChild.rows[0].step_id],
    )),
    "direct plan-step writes cannot bypass obvious-identifier DLP",
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "update public.plan_step_action_items set notes = 'Call 215-555-0100' where id = $1",
      [stagedChild.rows[0].action_id],
    )),
    "direct action-item writes cannot bypass obvious-identifier DLP",
  );

  const budgetResults = await Promise.all(
    Array.from({ length: 10 }, () => asUser(userB, async (client) => {
      const result = await client.query<{ consume_ai_budget: { allowed: boolean } }>(
        "select public.consume_ai_budget('pdf_mapping', 1)",
      );
      return result.rows[0].consume_ai_budget.allowed;
    })),
  );
  assert.equal(budgetResults.filter(Boolean).length, 3);

  const claimResults = await Promise.all(
    Array.from({ length: 8 }, () => asUser(userB, async (client) => {
      const result = await client.query<{ claim_ai_job: boolean }>(
        "select public.claim_ai_job($1, 'security-concurrency', 60)",
        [familyB],
      );
      return result.rows[0].claim_ai_job;
    })),
  );
  assert.equal(claimResults.filter(Boolean).length, 1);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select * from public.security_audit_log",
    )),
    "operator security audit is not browser-readable",
  );

  console.info("Database security integration checks passed.");
}

async function cleanup() {
  try {
    await admin.query("delete from private.ai_rate_counters where scope_key like $1", [`user:${userB}:%`]);
    await admin.query("delete from public.families where created_by_id = any($1::uuid[])", [[userA, userB]]);
    await admin.query("delete from public.resources where id = $1", [resourceId]);
    await admin.query(
      "delete from auth.users where id = any($1::uuid[])",
      [[userA, userB, unprovisionedUser]],
    );
  } finally {
    await pool.end();
    await admin.end();
  }
}

run()
  .finally(cleanup)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

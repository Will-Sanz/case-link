import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { createParentSqlFixture } from "./parent-sql-fixture";
import type { ServiceMandate, SupportIntake } from "../src/lib/parent/domain";
import { SNAP_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/constants";
import { SNAP_APPLICATION_SOURCE } from "../src/lib/parent/snap-application-fields";

async function main() {
  const connectionString =
    process.env.CASELINK_PARENT_DB_TEST_URL ??
    "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
  const target = new URL(connectionString);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.port !== "55322"
  ) {
    throw new Error(
      "Parent security fixtures require the isolated local parent database on port 55322.",
    );
  }
  const fixture = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE
    ? await createParentSqlFixture(
        process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE,
      )
    : null;
  const pool =
    fixture?.pool ??
    new Pool({
      connectionString,
      max: 8,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
  const admin =
    fixture?.admin ??
    new Client({ connectionString, connectionTimeoutMillis: 3000 });
  if (fixture)
    console.log(
      `Embedded SQL fixture: ${fixture.version}. Supabase Auth/Storage services and concurrency are not covered.`,
    );
  const ownerA = randomUUID(),
    ownerB = randomUUID(),
    staff = randomUUID(),
    unverified = randomUUID(),
    trusted = randomUUID();
  const schoolFamily = randomUUID();
  const users = [ownerA, ownerB, staff, unverified, trusted];
  const fixtureStoragePaths = new Map<string, string>();
  const parentGroups = [
    "parent_worker",
    "parent_storage_broker",
    "parent_retention_worker",
  ];
  type Membership = {
    role_name: string;
    grantor: string;
    admin_option: boolean;
    inherit_option: boolean;
    set_option: boolean;
  };
  let originalControls: Record<string, unknown> | undefined;
  let originalMemberships: Membership[] | undefined;
  let operatorName = "";
  const changedMemberships: { name: string; existed: boolean; set: boolean }[] =
    [];
  const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  async function memberships(): Promise<Membership[]> {
    return (
      await admin.query(
        "select granted.rolname role_name,grantor.rolname grantor,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles granted on granted.oid=m.roleid join pg_roles grantor on grantor.oid=m.grantor where member.rolname=current_user and granted.rolname=any($1::text[]) order by granted.rolname,grantor.rolname",
        [parentGroups],
      )
    ).rows;
  }
  async function removeFixtureStorageMetadata(bucket: string, path: string) {
    assert.equal(
      fixtureStoragePaths.get(path),
      bucket,
      "Only metadata created by this fixture may be erased directly.",
    );
    await admin.query("begin");
    try {
      // These rows have no object bytes; preserve Storage's deletion guard outside this transaction.
      await admin.query(
        "select set_config('storage.allow_delete_query','true',true)",
      );
      await admin.query(
        "delete from storage.objects where bucket_id=$1 and name=$2",
        [bucket, path],
      );
      await admin.query("commit");
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }
    assert.notEqual(
      (
        await admin.query(
          "select current_setting('storage.allow_delete_query',true) value",
        )
      ).rows[0].value,
      "true",
    );
  }
  const sessions = new Map<string, string>(
    users.map((id) => [id, randomUUID()]),
  );
  const intake: SupportIntake = {
    needs: ["food_now", "electricity"],
    urgency: "today",
    zip: "19104",
    language: "en",
    householdSize: 3,
    childrenUnderFive: null,
    pregnantOrPostpartum: null,
    incomeAmount: 500,
    incomeFrequency: "weekly",
    utilityProviders: ["peco"],
    shutoffDate: null,
    accountAuthority: "self",
    contactPreference: "in_app",
    adultConfirmed: true,
  };
  const mandate: ServiceMandate = {
    version: 1,
    mode: "full",
    recipientIds: ["philly-food", "peco-cap"],
    allowedActions: ["research", "prepare", "share", "submit", "follow_up"],
    allowedData: ["household", "income", "utility", "documents"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    maxAttempts: 3,
    maxRecipients: 2,
    bookingPreference: "ask_me",
    accepted: true,
  };
  let assertionCount = 0;
  async function role<T>(
    name:
      | "authenticated"
      | "anon"
      | "service_role"
      | "parent_worker"
      | "parent_retention_worker"
      | "parent_storage_broker",
    user: string | null,
    run: (db: PoolClient) => Promise<T>,
    method: "otp" | "password" = "otp",
  ): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`set local role ${name}`);
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: user,
          role: name,
          session_id: user ? sessions.get(user) : undefined,
          aal: "aal1",
          amr: [{ method }],
          user_metadata: { role: "parent", is_active: true },
        }),
      ]);
      const result = await run(db);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    } finally {
      db.release();
    }
  }
  async function denied(run: () => Promise<unknown>, code = "42501") {
    await assert.rejects(run, { code });
    assertionCount++;
  }
  async function start(
    user = ownerA,
    key = randomUUID(),
    payload: unknown = intake,
    permission: unknown = mandate,
  ): Promise<string> {
    return role(
      "authenticated",
      user,
      async (db) =>
        (
          await db.query("select public.parent_start_request($1,$2,$3) id", [
            JSON.stringify(payload),
            JSON.stringify(permission),
            key,
          ])
        ).rows[0].id,
    );
  }
  async function claim(requestId: string) {
    await admin.query(
      "update public.parent_jobs set state='queued',run_at=now(),lease_token=null,lease_until=null where request_id=$1",
      [requestId],
    );
    await admin.query(
      "update public.parent_jobs set state='done' where request_id in (select r.id from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=any($1::uuid[])) and request_id<>$2",
      [users, requestId],
    );
    return role(
      "parent_worker",
      null,
      async (db) =>
        (await db.query("select parent_private.parent_claim_job(120) job"))
          .rows[0].job,
    );
  }
  async function prepare(
    job: { jobId: string; leaseToken: string; request: { version: number } },
    action = "share",
    key = randomUUID(),
    packet: unknown = { householdSize: 3 },
  ) {
    return role(
      "parent_worker",
      null,
      async (db) =>
        (
          await db.query(
            "select parent_private.parent_prepare_operation($1,$2,$3,'peco-cap',$4,$5,array['household'],array[]::uuid[],$6) id",
            [
              job.jobId,
              job.leaseToken,
              job.request.version,
              action,
              JSON.stringify(packet),
              key,
            ],
          )
        ).rows[0].id,
    );
  }
  async function begin(
    job: { jobId: string; leaseToken: string },
    operation: string,
  ) {
    return role(
      "parent_worker",
      null,
      async (db) =>
        (
          await db.query(
            "select parent_private.parent_begin_operation($1,$2,$3) operation",
            [operation, job.jobId, job.leaseToken],
          )
        ).rows[0].operation,
    );
  }
  async function finish(
    job: { jobId: string; leaseToken: string },
    operation: string,
    state = "sent",
    evidence = {
      source: "synthetic_partner_transport",
      reference: "fixture-receipt",
    },
  ) {
    return role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_finish_operation($1,$2,$3,$4,$5,null)",
        [operation, job.jobId, job.leaseToken, state, JSON.stringify(evidence)],
      ),
    );
  }

  await admin.connect();
  try {
    const ready = await admin.query(
      "select to_regclass('public.parent_requests') configured,to_regclass('public.parent_snap_application_details') snap_configured,to_regprocedure('public.parent_reaffirm_snap_application_details(uuid,integer,jsonb,text,uuid,text[])') snap_preview_configured",
    );
    assert.ok(
      ready.rows[0].configured,
      "Apply the parent migration to the isolated local test project first",
    );
    assert.ok(ready.rows[0].snap_configured && ready.rows[0].snap_preview_configured,
      "Apply the reviewed private SNAP details and preview migrations to the isolated test project first");
    if (!fixture) {
      originalControls = (
        await admin.query(
          "select to_jsonb(c) value from parent_private.processing_controls c where singleton",
        )
      ).rows[0]?.value;
      assert.ok(
        originalControls,
        "The local fixture requires an existing processing-control row.",
      );
      operatorName = (await admin.query("select current_user name")).rows[0]
        .name;
      originalMemberships = await memberships();
      for (const name of parentGroups) {
        const existing = originalMemberships.filter(
          (membership) => membership.role_name === name,
        );
        if (existing.some((membership) => membership.set_option)) continue;
        assert.ok(
          existing.some((membership) => membership.admin_option),
          `The isolated fixture operator needs an existing ADMIN membership for ${name}; no role membership is provisioned by this test.`,
        );
        const own = existing.find(
          (membership) => membership.grantor === operatorName,
        );
        changedMemberships.push({
          name,
          existed: Boolean(own),
          set: own?.set_option ?? false,
        });
        await admin.query(
          `grant ${identifier(name)} to ${identifier(operatorName)} with ${own ? "" : "admin false, inherit false, "}set true`,
        );
      }
      assert.notEqual(
        (
          await admin.query(
            "select current_setting('storage.allow_delete_query',true) value",
          )
        ).rows[0].value,
        "true",
        "The fixture requires Storage's normal direct-deletion guard.",
      );
    }
    await admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic security fixture',approved_until=now()+interval '1 day' where singleton",
    );
    for (const user of users) {
      await admin.query(
        "insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,$3,false)",
        [
          user,
          `parent-fixture-${user}@example.test`,
          user === unverified ? null : new Date(),
        ],
      );
      await admin.query(
        "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
        [sessions.get(user), user],
      );
    }
    await admin.query(
      "insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)",
      [staff, `school-fixture-${staff}@example.test`],
    );
    await denied(() =>
      role("authenticated", staff, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    await denied(() =>
      role("authenticated", unverified, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    await denied(() =>
      role("anon", null, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query("select parent_private.parent_claim_job(null)"),
        ),
      "23514",
    );
    await denied(
      () =>
        role("parent_retention_worker", null, (db) =>
          db.query("select parent_private.parent_claim_cleanup(null)"),
        ),
      "23514",
    );
    await admin.query(
      "update parent_private.processing_controls set enabled=false where singleton",
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select public.parent_before_user_created('{}') result",
        )
      ).rows[0].result.error.http_code,
      403,
    );
    assertionCount++;
    await admin.query(
      "update parent_private.processing_controls set enabled=true where singleton",
    );
    const key = randomUUID(),
      requestA = await start(ownerA, key),
      requestB = await start(ownerB);
    await denied(() =>
      role("anon", null, (db) =>
        db.query("select public.parent_authorization_window()"),
      ),
    );
    await role("authenticated", ownerA, async (db) => {
      await db.query("savepoint quoted_deadline");
      const issued = (
        await db.query(
          "select public.parent_authorization_window() value,now() checked_at",
        )
      ).rows[0];
      const quote = issued.value;
      assert.ok(
        Date.parse(quote.issuedAt) <= new Date(issued.checked_at).getTime(),
      );
      assert.ok(
        Date.parse(quote.expiresAt) > new Date(issued.checked_at).getTime(),
      );
      assert.ok(
        Date.parse(quote.expiresAt) - Date.parse(quote.issuedAt) <=
          30 * 86400000,
      );
      assert.ok(
        (
          await db.query("select public.parent_start_request($1,$2,$3) id", [
            JSON.stringify(intake),
            JSON.stringify({ ...mandate, expiresAt: quote.expiresAt }),
            randomUUID(),
          ])
        ).rows[0].id,
      );
      await db.query("rollback to savepoint quoted_deadline");
      assertionCount += 4;
    });

    // Native roles and real session rows only; this does not test GoTrue-issued tokens or PostgREST.
    const snapControls = (await admin.query(
      "select to_jsonb(c) value from parent_private.processing_controls c where singleton",
    )).rows[0].value;
    const snapKey = randomUUID();
    const snapDetails = {
      zip: "19104", language: "en",
      applicant: { firstName: "SNAP-PRIVATE-CANARY", lastName: "Synthetic" },
      address: { street: "100 Fixture Street", city: "Philadelphia", state: "PA" },
    };
    const snapArgs = [
      JSON.stringify({ ...intake, needs: ["snap_new"], utilityProviders: [] }),
      JSON.stringify({ ...mandate, mode: "prepare_only", recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"], allowedData: ["household", "income"] }),
      JSON.stringify(snapDetails), SNAP_APPLICATION_NOTICE_VERSION, snapKey,
    ];
    const startSnap = () => role("authenticated", ownerA, (db) => db.query(
      "select public.parent_start_snap_application($1,$2,$3,$4,$5) id", snapArgs,
    ));
    let snapRequest: string | undefined;
    try {
      await admin.query("update parent_private.processing_controls set snap_details_enabled=false where singleton");
      await denied(startSnap);
      assert.equal((await admin.query("select count(*)::int n from public.parent_requests where start_key=$1", [snapKey])).rows[0].n, 0);
      assert.deepEqual((await role("authenticated", ownerA, (db) => db.query("select public.parent_snap_application_collection() value"))).rows[0].value,
        { collectionEnabled: false, noticeVersion: null });
      assertionCount += 2;
      await admin.query(`update parent_private.processing_controls set snap_details_enabled=true,
        snap_details_approval_reference='isolated synthetic SNAP security fixture',snap_details_approved_until=now()+interval '1 hour',snap_details_notice_version=$1 where singleton`,
        [SNAP_APPLICATION_NOTICE_VERSION]);
      snapRequest = (await startSnap()).rows[0].id;
      const original = (await role("authenticated", ownerA, (db) => db.query(
        "select * from public.parent_snap_application_details where request_id=$1", [snapRequest],
      ))).rows[0];
      assert.equal(original.request_version, 2);
      assert.deepEqual(original.details, snapDetails);
      assert.deepEqual(original.source, SNAP_APPLICATION_SOURCE);
      assert.equal((await admin.query("select request_version from public.parent_jobs where request_id=$1", [snapRequest])).rows[0].request_version, 2);
      for (const user of [ownerB, staff]) {
        assert.equal((await role("authenticated", user, (db) => db.query(
          "select count(*)::int n from public.parent_snap_application_details where request_id=$1", [snapRequest],
        ))).rows[0].n, 0);
        assertionCount++;
      }
      for (const deniedRole of ["anon", "service_role", "parent_worker"] as const)
        await denied(() => role(deniedRole, null, (db) => db.query("select * from public.parent_snap_application_details")));
      await denied(() => role("authenticated", ownerB, (db) => db.query(
        "select public.parent_save_snap_application_details($1,2,$2,$3,$4)", [snapRequest, JSON.stringify(snapDetails), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()],
      )));
      await denied(() => role("authenticated", ownerA, (db) => db.query(
        "insert into public.parent_snap_application_details select * from public.parent_snap_application_details where id=$1", [original.id],
      )));
      await denied(() => role("authenticated", ownerA, (db) => db.query("delete from public.parent_snap_application_details where id=$1", [original.id])));
      await denied(() => admin.query("update public.parent_snap_application_details set details='{}' where id=$1", [original.id]), "23514");
      const snapState = async () => (await admin.query(`select to_jsonb(r) request,
        (select to_jsonb(j) from public.parent_jobs j where j.request_id=r.id) job,
        (select count(*)::int from public.parent_events e where e.request_id=r.id) events
        from public.parent_requests r where r.id=$1`, [snapRequest])).rows[0];
      const beforeRetry = await snapState();
      assert.equal((await startSnap()).rows[0].id, snapRequest);
      assert.deepEqual(await snapState(), beforeRetry);
      assert.deepEqual((await role("authenticated", ownerA, (db) => db.query(
        "select * from public.parent_snap_application_details where id=$1", [original.id],
      ))).rows[0], original);
      assert.ok(!JSON.stringify(beforeRetry).includes("SNAP-PRIVATE-CANARY"));
      const correctionKey = randomUUID(), corrected = { ...snapDetails, address: { ...snapDetails.address, street: "101 Fixture Street" } };
      const correctSnap = () => role("authenticated", ownerA, (db) => db.query(
        "select public.parent_save_snap_application_details($1,2,$2,$3,$4) id", [snapRequest, JSON.stringify(corrected), SNAP_APPLICATION_NOTICE_VERSION, correctionKey],
      ));
      const correctedId = (await correctSnap()).rows[0].id;
      const current = (await role("authenticated", ownerA, (db) => db.query(
        "select * from public.parent_snap_application_details where id=$1", [correctedId],
      ))).rows[0];
      assert.equal(current.revision, 2); assert.equal(current.request_version, 3);
      assert.deepEqual(current.details, corrected);
      assert.deepEqual({ ...current.provenance, "address.street": original.provenance["address.street"] }, original.provenance);
      assert.equal((await correctSnap()).rows[0].id, correctedId);
      await denied(startSnap, "40001");
      await denied(() => role("authenticated", ownerA, (db) => db.query(
        "select public.parent_save_snap_application_details($1,2,$2,$3,$4)", [snapRequest, JSON.stringify(corrected), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()],
      )), "40001");
      assert.ok(!JSON.stringify(await snapState()).includes("SNAP-PRIVATE-CANARY"));
      assertionCount += 14;
      const stale = { ...current.provenance, "address.street": { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" } };
      await admin.query(`insert into public.parent_snap_application_details(id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
        select $1,request_id,revision+1,base_version,request_version,details,$2,source,notice_version,$3 from public.parent_snap_application_details where id=$4`,
        [randomUUID(), JSON.stringify(stale), randomUUID(), correctedId]);
      const reaffirmArgs = [snapRequest, JSON.stringify(corrected), SNAP_APPLICATION_NOTICE_VERSION, randomUUID(), ["address.street"]];
      const reaffirm = () => role("authenticated", ownerA, (db) => db.query(
        "select public.parent_reaffirm_snap_application_details($1,3,$2,$3,$4,$5) id", reaffirmArgs));
      const reaffirmId = (await reaffirm()).rows[0].id;
      const reaffirmed = (await role("authenticated", ownerA, (db) => db.query(
        "select * from public.parent_snap_application_details where id=$1", [reaffirmId]))).rows[0];
      assert.deepEqual(reaffirmed.confirmed_paths, ["address.street"]);
      assert.deepEqual({ ...reaffirmed.provenance, "address.street": stale["address.street"] }, stale);
      assert.equal(reaffirmed.request_version, 4); assert.equal((await reaffirm()).rows[0].id, reaffirmId);
      assertionCount += 4;
    } finally {
      try {
        if (snapRequest) {
          await admin.query("delete from public.parent_requests where id=$1 and household_id=(select id from public.parent_households where owner_id=$2)", [snapRequest, ownerA]);
          assert.equal((await admin.query("select count(*)::int n from public.parent_snap_application_details where request_id=$1", [snapRequest])).rows[0].n, 0);
          assert.equal((await admin.query("select count(*)::int n from auth.users where id=$1", [ownerA])).rows[0].n, 1);
          assertionCount += 2;
        }
      } finally {
        await admin.query(`update parent_private.processing_controls c set
          (snap_details_enabled,snap_details_approval_reference,snap_details_approved_until,snap_details_notice_version)=
          (select r.snap_details_enabled,r.snap_details_approval_reference,r.snap_details_approved_until,r.snap_details_notice_version
          from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton`, [JSON.stringify(snapControls)]);
        assert.deepEqual((await admin.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0].value, snapControls);
        assertionCount++;
      }
    }
    console.log("Private SNAP native-role gate, atomic start, owned immutable revisions, replay, correction and cascade cleanup passed; purpose controls restored exactly.");

    // Shared identities get a new, owned parent household, never a school role grant.
    await admin.query(
      "update parent_private.processing_controls set existing_accounts_enabled=true where singleton",
    );
    await denied(() =>
      role("authenticated", staff, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    const staffRequest = (
      await role(
        "authenticated",
        staff,
        (db) =>
          db.query("select public.parent_start_request($1,$2,$3) id", [
            JSON.stringify({ ...intake, contactPreference: "email" }),
            JSON.stringify(mandate),
            randomUUID(),
          ]),
        "password",
      )
    ).rows[0].id;
    await admin.query(
      "insert into public.families(id,name,created_by_id) values($1,'Synthetic school family',$2)",
      [schoolFamily, staff],
    );
    await admin.query(
      "update public.parent_accounts set preferences=jsonb_set(preferences,'{contactPreference}','\"email\"') where id=$1",
      [staff],
    );
    assert.equal(
      (
        await role(
          "authenticated",
          staff,
          (db) =>
            db.query(
              "select count(*)::int n from public.parent_requests where id=$1",
              [requestA],
            ),
          "password",
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    assert.equal(
      (
        await admin.query(
          "select parent_private.current_grant($1,1) grant_allowed,parent_private.notification_allowed($1,1) notification_allowed",
          [staffRequest],
        )
      ).rows[0].grant_allowed,
      true,
    );
    assertionCount++;
    assert.equal(
      (
        await admin.query(
          "select parent_private.notification_allowed($1,1) allowed",
          [staffRequest],
        )
      ).rows[0].allowed,
      true,
    );
    assertionCount++;
    await admin.query(
      "update public.app_users set is_active=false where id=$1",
      [staff],
    );
    await denied(() =>
      role(
        "authenticated",
        staff,
        (db) => db.query("select public.parent_ensure_account()"),
        "password",
      ),
    );
    const disabledShared = (
      await admin.query(
        "select parent_private.current_grant($1,1) grant_allowed,parent_private.notification_allowed($1,1) notification_allowed",
        [staffRequest],
      )
    ).rows[0];
    assert.deepEqual(disabledShared, {
      grant_allowed: false,
      notification_allowed: false,
    });
    assertionCount++;
    await admin.query(
      "update public.app_users set is_active=true where id=$1",
      [staff],
    );
    const completionEvent = (
      await admin.query(
        "insert into public.parent_events(request_id,kind,actor,summary) values($1,'support.support_received','caselink','Synthetic shared-account completion') returning id",
        [staffRequest],
      )
    ).rows[0].id;
    await admin.query(
      "insert into parent_private.notification_outbox(event_id,request_id,request_version,kind,completion_notice) values($1,$2,1,'outcome',true)",
      [completionEvent, staffRequest],
    );
    await admin.query(
      "update public.parent_requests set status='closed',closed_reason='completed' where id=$1",
      [staffRequest],
    );
    assert.equal(
      (
        await admin.query(
          "select parent_private.notification_allowed($1,1) allowed",
          [staffRequest],
        )
      ).rows[0].allowed,
      true,
    );
    assertionCount++;
    await admin.query(
      "update public.app_users set is_active=false where id=$1",
      [staff],
    );
    assert.equal(
      (
        await admin.query(
          "select parent_private.notification_allowed($1,1) allowed",
          [staffRequest],
        )
      ).rows[0].allowed,
      false,
    );
    assertionCount++;
    await admin.query(
      "update public.app_users set is_active=true where id=$1",
      [staff],
    );
    await role(
      "authenticated",
      staff,
      (db) => db.query("select public.parent_request_deletion()"),
      "password",
    );
    const sharedDeletion = (
      await role("parent_retention_worker", null, (db) =>
        db.query("select parent_private.parent_claim_cleanup(100) batch"),
      )
    ).rows[0].batch;
    assert.ok(sharedDeletion.accountIds.includes(staff));
    assertionCount++;
    await role("parent_retention_worker", null, (db) =>
      db.query("select parent_private.parent_finish_cleanup($1,$2,$3,$4,$5)", [
        sharedDeletion.batchId,
        sharedDeletion.leaseToken,
        [],
        sharedDeletion.accountIds,
        [],
      ]),
    );
    const preservedIdentity = (
      await admin.query(
        "select exists(select 1 from auth.users where id=$1) auth_exists,exists(select 1 from public.app_users where id=$1) staff_exists,exists(select 1 from public.families where id=$2) school_exists,exists(select 1 from public.parent_accounts where id=$1) parent_exists,exists(select 1 from public.parent_requests where id=$3) request_exists",
        [staff, schoolFamily, staffRequest],
      )
    ).rows[0];
    assert.deepEqual(preservedIdentity, {
      auth_exists: true,
      staff_exists: true,
      school_exists: true,
      parent_exists: false,
      request_exists: false,
    });
    assertionCount++;
    await denied(() =>
      role(
        "authenticated",
        staff,
        (db) => db.query("select public.parent_ensure_account()"),
        "password",
      ),
    );
    await denied(
      () =>
        role("authenticated", ownerA, (db) =>
          db.query("select public.parent_control_request($1,null)", [requestA]),
        ),
      "23514",
    );
    assert.equal(await start(ownerA, key), requestA);
    await admin.query(
      "update parent_private.processing_controls set enabled=false where singleton",
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query("select public.parent_authorization_window()"),
      ),
    );
    assert.equal(
      (
        await role("authenticated", ownerA, (db) =>
          db.query("select count(*)::int n from public.parent_requests"),
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    await denied(() => start(ownerA, randomUUID()));
    await admin.query(
      "update parent_private.processing_controls set enabled=true where singleton",
    );

    assertionCount++;
    await denied(
      () => start(ownerA, key, { ...intake, zip: "19103" }),
      "23514",
    );
    await denied(
      () =>
        start(ownerA, randomUUID(), { ...intake, privateExtra: "not allowed" }),
      "23514",
    );
    await denied(
      () =>
        start(ownerA, randomUUID(), intake, { ...mandate, maxAttempts: null }),
      "23514",
    );
    await denied(
      () =>
        start(ownerA, randomUUID(), intake, {
          ...mandate,
          recipientIds: ["unverified-recipient"],
        }),
      "23514",
    );
    await denied(
      () =>
        role("authenticated", ownerA, (db) =>
          db.query("select public.parent_correct_request($1,$2,null)", [
            requestA,
            JSON.stringify(intake),
          ]),
        ),
      "40001",
    );
    assert.equal(
      (
        await role("authenticated", ownerB, (db) =>
          db.query(
            "select count(*)::int n from public.parent_requests where id=$1",
            [requestA],
          ),
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    assert.equal(
      (
        await role("authenticated", ownerA, (db) =>
          db.query("select count(*)::int n from public.families"),
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_control_request($1,'cancel')", [
          requestA,
        ]),
      ),
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query(
          "update public.parent_requests set status='closed' where id=$1",
          [requestA],
        ),
      ),
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query("select parent_private.parent_claim_job(120)"),
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select * from public.parent_requests"),
      ),
    );
    await denied(() =>
      role("service_role", null, (db) =>
        db.query("select * from public.parent_requests"),
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select * from public.families"),
      ),
    );
    console.log(
      "Parent account, household, direct RPC, legacy and privileged-role isolation passed.",
    );

    const job = await claim(requestA);
    assert.equal(job.request.id, requestA);
    assertionCount++;
    await denied(() => prepare(job)); // Partnership never automatically enables sharing.
    await admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,verified_until,allowed_fields,field_categories,required_acts) values('peco-cap','share',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['householdSize','zip'],'{\"householdSize\":\"household\",\"zip\":\"household\"}',array[]::text[])",
    );
    const operationKey = randomUUID(),
      operation = await prepare(job, "share", operationKey);
    assert.equal(await prepare(job, "share", operationKey), operation);
    assertionCount++;
    await denied(
      () => prepare(job, "share", operationKey, { householdSize: 3, zip: "19104" }),
      "23514",
    );
    await denied(() => prepare(job, "share", randomUUID(), { householdSize: 4 }));
    const dispatched = await begin(job, operation);
    assert.equal(dispatched.idempotencyKey, operationKey);
    assertionCount++;
    await denied(() => begin(job, operation));
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_finish_operation($1,$2,$3,'sent','{}',null)",
            [operation, job.jobId, job.leaseToken],
          ),
        ),
      "23514",
    );
    await role("authenticated", ownerA, (db) =>
      db.query("select public.parent_control_request($1,'cancel')", [requestA]),
    );
    await finish(job, operation); // Preserve a genuine in-flight receipt after revocation.
    await finish(job, operation); // An identical receipt is idempotent.
    await denied(() => finish(job, operation, "delivery_unknown"), "23514");
    assert.equal(
      (
        await admin.query(
          "select state from public.parent_operations where id=$1",
          [operation],
        )
      ).rows[0].state,
      "sent",
    );
    assertionCount++;
    await denied(() => prepare(job));
    await denied(
      () =>
        admin.query(
          "update public.parent_operations set packet='{}' where id=$1",
          [operation],
        ),
      "23514",
    );
    console.log(
      "Bounded execution, disabled capabilities, immutable packets, idempotency and post-cancel receipt reconciliation passed.",
    );

    const evidenceRequest = await start(),
      evidenceJob = await claim(evidenceRequest);
    await admin.query(
      "update parent_private.provider_capabilities set required_acts=array['identity'],allowed_fields=array['householdSize','zip'],field_categories='{\"householdSize\":\"household\",\"zip\":\"household\"}' where program_id='peco-cap' and action='share'",
    );
    const evidenceOperation = await prepare(
      evidenceJob,
      "share",
      randomUUID(),
      { householdSize: 3, zip: "19104" },
    );
    await denied(() => begin(evidenceJob, evidenceOperation));
    await admin.query(
      "insert into parent_private.trusted_memberships(user_id,request_id,operation_id,program_id,role,allowed_fields,can_record_status,can_verify_personal_acts,purpose,permission_reference,expires_at) values($1,$2,$3,'peco-cap','partner',array['householdSize'],false,true,'Synthetic referral receipt','fixture permission',now()+interval '1 hour')",
      [trusted, evidenceRequest, evidenceOperation],
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query(
          "select public.parent_record_personal_act($1,'identity','fixture-act',now())",
          [evidenceOperation],
        ),
      ),
    );
    await denied(() =>
      role("authenticated", trusted, (db) =>
        db.query("select public.parent_read_referral_packet($1)", [
          evidenceOperation,
        ]),
      ),
    );
    await admin.query(
      "update public.parent_jobs set state='waiting',run_at='infinity' where id=$1",
      [evidenceJob.jobId],
    );
    await role("authenticated", trusted, (db) =>
      db.query(
        "select public.parent_record_personal_act($1,'identity','fixture-act',now())",
        [evidenceOperation],
      ),
    );
    assert.equal(
      (
        await admin.query("select state from public.parent_jobs where id=$1", [
          evidenceJob.jobId,
        ])
      ).rows[0].state,
      "queued",
    );
    assertionCount++;
    const firstAct = (
      await admin.query(
        "select verified_at::text observed_at from parent_private.personal_act_evidence where operation_id=$1 and reference='fixture-act'",
        [evidenceOperation],
      )
    ).rows[0];
    await admin.query(
      "update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1",
      [evidenceOperation],
    );
    await admin.query(
      "update public.parent_jobs set state='waiting',run_at='infinity' where id=$1",
      [evidenceJob.jobId],
    );
    await role("authenticated", trusted, (db) =>
      db.query(
        "select public.parent_record_personal_act($1,'identity','fixture-act',$2)",
        [evidenceOperation, firstAct.observed_at],
      ),
    );
    assert.equal(
      (await admin.query("select state from public.parent_jobs where id=$1", [evidenceJob.jobId])).rows[0].state,
      "waiting",
    );
    assertionCount++;
    assert.equal(
      (await admin.query("select expires_at<now() expired from parent_private.personal_act_evidence where operation_id=$1", [evidenceOperation])).rows[0].expired,
      true,
    );
    assertionCount++;
    await role("authenticated", trusted, (db) =>
      db.query(
        "select public.parent_record_personal_act($1,'identity','fixture-act-renewed',now())",
        [evidenceOperation],
      ),
    );
    assert.equal(
      (await admin.query("select count(*)::integer count from parent_private.personal_act_evidence where operation_id=$1", [evidenceOperation])).rows[0].count,
      2,
    );
    assertionCount++;
    assert.equal(
      (await admin.query("select state from public.parent_jobs where id=$1", [evidenceJob.jobId])).rows[0].state,
      "queued",
    );
    assertionCount++;
    assert.equal(
      (await admin.query("select count(*)::integer count from public.parent_events where request_id=$1 and kind='personal_act.verified'", [evidenceRequest])).rows[0].count,
      2,
    );
    assertionCount++;
    await admin.query(
      "update public.parent_jobs set state='leased' where id=$1",
      [evidenceJob.jobId],
    );
    await denied(() =>
      role("authenticated", trusted, (db) =>
        db.query(
          "select public.parent_record_referral_status($1,'partner_received',$2)",
          [
            evidenceOperation,
            JSON.stringify({
              reference: "fixture",
              observedAt: new Date().toISOString(),
            }),
          ],
        ),
      ),
    );
    await admin.query(
      "update parent_private.trusted_memberships set can_record_status=true where operation_id=$1",
      [evidenceOperation],
    );
    await begin(evidenceJob, evidenceOperation);
    await finish(evidenceJob, evidenceOperation, "sent", {
      source: "provider_api",
      reference: "fixture-referral",
    });
    const referral = (
      await role("authenticated", trusted, (db) =>
        db.query("select public.parent_read_referral_packet($1) packet", [
          evidenceOperation,
        ]),
      )
    ).rows[0].packet;
    assert.deepEqual(referral.packet, { householdSize: 3 });
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_read_referral_packet($1)", [
          evidenceOperation,
        ]),
      ),
    );
    const receiptEvidence = {
      reference: "fixture-provider-received",
      observedAt: new Date().toISOString(),
    };
    const receiptId = (
      await role("authenticated", trusted, (db) =>
        db.query(
          "select public.parent_record_referral_status($1,'partner_received',$2) id",
          [evidenceOperation, JSON.stringify(receiptEvidence)],
        ),
      )
    ).rows[0].id;
    assert.equal(
      (
        await role("authenticated", trusted, (db) =>
          db.query(
            "select public.parent_record_referral_status($1,'partner_received',$2) id",
            [evidenceOperation, JSON.stringify(receiptEvidence)],
          ),
        )
      ).rows[0].id,
      receiptId,
    );
    assertionCount++;
    await denied(
      () =>
        role("authenticated", trusted, (db) =>
          db.query(
            "select public.parent_record_referral_status($1,'sent',$2)",
            [
              evidenceOperation,
              JSON.stringify({
                ...receiptEvidence,
                reference: "different-receipt",
              }),
            ],
          ),
        ),
      "23514",
    );
    await admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,verified_until,allowed_fields,field_categories,required_acts) values('peco-cap','follow_up',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['statusReference'],'{\"statusReference\":\"household\"}',array[]::text[])",
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      const follow = (
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_prepare_operation($1,$2,1,'peco-cap','follow_up',$3,array['household'],array[]::uuid[],$4,'electricity') id",
            [
              evidenceJob.jobId,
              evidenceJob.leaseToken,
              JSON.stringify({ statusReference: "fixture-provider-received" }),
              randomUUID(),
            ],
          ),
        )
      ).rows[0].id;
      await begin(evidenceJob, follow);
      await finish(evidenceJob, follow, "sent", {
        source: "provider_api",
        reference: `fixture-follow-up-${cycle}`,
      });
    }
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.parent_operations where request_id=$1 and action='follow_up'",
          [evidenceRequest],
        )
      ).rows[0].n,
      2,
    );
    assertionCount++;
    await role("authenticated", ownerA, (db) =>
      db.query(
        "select public.parent_report_outcome($1,'food_now','support_received','I received food')",
        [evidenceRequest],
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select state from public.parent_operations where id=$1",
          [evidenceOperation],
        )
      ).rows[0].state,
      "partner_received",
    );
    assertionCount++;
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_close_job($1,$2,'all_permitted_routes_exhausted','No response','service_operator','Return for support')",
            [evidenceJob.jobId, evidenceJob.leaseToken],
          ),
        ),
      "23514",
    );
    await role("authenticated", ownerA, (db) =>
      db.query(
        "select public.parent_close_request($1,'parent_choice','I chose to stop','parent','Start a new request whenever needed')",
        [evidenceRequest],
      ),
    );
    await denied(() =>
      role("authenticated", trusted, (db) =>
        db.query("select public.parent_read_referral_packet($1)", [
          evidenceOperation,
        ]),
      ),
    );
    await admin.query(
      "update parent_private.provider_capabilities set required_acts=array[]::text[],allowed_fields=array['householdSize'],field_categories='{\"householdSize\":\"household\"}' where program_id='peco-cap' and action='share'",
    );
    console.log(
      "Referral-scoped field access, packet-bound personal acts, trusted receipts, parent-reported outcomes and honest closure passed.",
    );

    // Completion is independent per need; a shared benefits partner does not imply shared outcomes.
    await admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,verified_until,allowed_fields,field_categories,required_acts) values('philly-food','share',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['householdSize'],'{\"householdSize\":\"household\"}',array[]::text[]),('uesf-benefits','share',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['householdSize'],'{\"householdSize\":\"household\"}',array[]::text[])",
    );
    for (const mixed of [false, true]) {
      const completedRequest = await start(ownerA, randomUUID(), {
          ...intake,
          contactPreference: "email",
        }),
        completedJob = await claim(completedRequest);
      await role("authenticated", ownerA, (db) =>
        db.query("select public.parent_update_preferences($1)", [
          JSON.stringify({
            contactPreference: "email",
            language: "en",
            quietHoursStart: 0,
            quietHoursEnd: 0,
          }),
        ]),
      );
      for (const [program, need] of [
        ["philly-food", "food_now"],
        ["peco-cap", "electricity"],
      ]) {
        const id = (
          await role("parent_worker", null, (db) =>
            db.query(
              "select parent_private.parent_prepare_operation($1,$2,1,$3,'share',$4,array['household'],array[]::uuid[],$5,$6) id",
              [
                completedJob.jobId,
                completedJob.leaseToken,
                program,
                JSON.stringify({ householdSize: 3 }),
                randomUUID(),
                need,
              ],
            ),
          )
        ).rows[0].id;
        await begin(completedJob, id);
        await finish(
          completedJob,
          id,
          mixed && need === "electricity" ? "declined" : "support_received",
          { source: "provider_api", reference: `fixture-${need}` },
        );
        const resultState =
          mixed && need === "electricity" ? "declined" : "support_received";
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_record_service_event($1,$2,$3)",
            [
              completedJob.jobId,
              completedJob.leaseToken,
              JSON.stringify({
                id: (need === "food_now" ? "d" : "e").repeat(64),
                kind: `support.${resultState}`,
                need,
                programId: program,
                receipt: { reference: `fixture-${need}` },
              }),
            ],
          ),
        );
      }
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_save_job_plan($1,$2,1,$3,'[]',null,null,'none')",
          [
            completedJob.jobId,
            completedJob.leaseToken,
            JSON.stringify({
              version: 1,
              routes: [
                {
                  need: "food_now",
                  programId: "philly-food",
                  state: "prepared",
                },
                {
                  need: "electricity",
                  programId: "peco-cap",
                  state: "prepared",
                },
              ],
            }),
          ],
        ),
      );
      assert.equal(
        (
          await admin.query(
            "select plan->'routes'->0->>'state' state from public.parent_requests where id=$1",
            [completedRequest],
          )
        ).rows[0].state,
        "support_received",
      );
      assertionCount++;
      assert.equal(
        (
          await admin.query(
            "select status from public.parent_requests where id=$1",
            [completedRequest],
          )
        ).rows[0].status,
        "closed",
      );
      assertionCount++;
      assert.equal(
        (
          await admin.query(
            "select count(*)::int n from parent_private.notification_outbox where request_id=$1 and state='queued' and completion_notice",
            [completedRequest],
          )
        ).rows[0].n,
        1,
      );
      assertionCount++;
      const finalNotice = (
        await role("parent_worker", null, (db) =>
          db.query("select parent_private.parent_claim_notification() value"),
        )
      ).rows[0].value;
      const finalPreview = (
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_begin_notification($1,$2) value",
            [finalNotice.notificationId, finalNotice.leaseToken],
          ),
        )
      ).rows[0].value;
      assert.equal(finalPreview.requestPath, `/support/${completedRequest}`);
      assertionCount++;
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_finish_notification($1,$2,'sent','fixture-completed-mail')",
          [finalNotice.notificationId, finalNotice.leaseToken],
        ),
      );
    }
    const combinedRequest = await start(
        ownerA,
        randomUUID(),
        { ...intake, needs: ["snap_new", "wic_new"] },
        { ...mandate, recipientIds: ["uesf-benefits"], maxRecipients: 1 },
      ),
      combinedJob = await claim(combinedRequest);
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_prepare_operation($1,$2,1,'uesf-benefits','share',$3,array['household'],array[]::uuid[],$4)",
            [
              combinedJob.jobId,
              combinedJob.leaseToken,
              JSON.stringify({ householdSize: 3 }),
              randomUUID(),
            ],
          ),
        ),
      "23514",
    );
    const snapOperation = (
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,1,'uesf-benefits','share',$3,array['household'],array[]::uuid[],$4,'snap_new') id",
          [
            combinedJob.jobId,
            combinedJob.leaseToken,
            JSON.stringify({ householdSize: 3 }),
            randomUUID(),
          ],
        ),
      )
    ).rows[0].id;
    await begin(combinedJob, snapOperation);
    await finish(combinedJob, snapOperation, "declined", {
      source: "provider_api",
      reference: "fixture-snap-only",
    });
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_close_job($1,$2,'all_permitted_routes_exhausted','Only SNAP declined','parent','Return for help')",
            [combinedJob.jobId, combinedJob.leaseToken],
          ),
        ),
      "23514",
    );
    await denied(
      () =>
        admin.query(
          "update public.parent_operations set need='wic_new' where id=$1",
          [snapOperation],
        ),
      "23514",
    );
    console.log(
      "All-success and mixed-outcome closure pass; an unattempted WIC need remains open despite a shared partner's SNAP decision.",
    );

    if (fixture) {
      await admin.query(
        "insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active) values('fixture-form','1','peco-cap',array['electricity'],$1,'fixture/template.pdf','{\"HouseholdSize\":\"householdSize\"}',array[]::text[],'https://example.test/form',now()+interval '1 day',true)",
        ["a".repeat(64)],
      );
      await admin.query(
        "update parent_private.provider_capabilities set requires_form=true where program_id='peco-cap' and action='share'",
      );
      const formRequest = await start(
          ownerA,
          randomUUID(),
          { ...intake, needs: ["electricity"] },
          { ...mandate, recipientIds: ["peco-cap"], maxRecipients: 1 },
        ),
        formJob = await claim(formRequest);
      await denied(() => prepare(formJob));
      const artifact = (
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_register_form_artifact($1,$2,'peco-cap','fixture-form','1',$3,$4,'electricity') artifact",
            [
              formJob.jobId,
              formJob.leaseToken,
              JSON.stringify({ householdSize: 3 }),
              "b".repeat(64),
            ],
          ),
        )
      ).rows[0].artifact;
      await denied(() =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)",
            [formJob.jobId, formJob.leaseToken, artifact.id, "b".repeat(64)],
          ),
        ),
      );
      // This is fixture metadata only. Real Storage uploads and PDF bytes require the separate service/rendering checks.
      fixtureStoragePaths.set(artifact.object_path, "parent-form-artifacts");
      await admin.query(
        "insert into storage.objects(bucket_id,name) values('parent-form-artifacts',$1)",
        [artifact.object_path],
      );
      await denied(() =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)",
            [formJob.jobId, formJob.leaseToken, artifact.id, "c".repeat(64)],
          ),
        ),
      );
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)",
          [formJob.jobId, formJob.leaseToken, artifact.id, "b".repeat(64)],
        ),
      );
      const formOperation = (
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_prepare_operation($1,$2,1,'peco-cap','share',$3,array['household'],array[]::uuid[],$4,'electricity',$5) id",
            [
              formJob.jobId,
              formJob.leaseToken,
              JSON.stringify({ householdSize: 3 }),
              randomUUID(),
              artifact.id,
            ],
          ),
        )
      ).rows[0].id;
      assert.equal(
        (await begin(formJob, formOperation)).artifact.content_sha256,
        "b".repeat(64),
      );
      assertionCount++;
      await finish(formJob, formOperation, "sent", {
        source: "provider_api",
        reference: "fixture-form-submission",
      });
      await denied(
        () =>
          admin.query(
            "update public.parent_form_artifacts set content_sha256=$1 where id=$2",
            ["c".repeat(64), artifact.id],
          ),
        "23514",
      );
      await role("authenticated", ownerA, (db) =>
        db.query("select public.parent_control_request($1,'cancel')", [
          formRequest,
        ]),
      );
      await admin.query(
        "update public.parent_requests set updated_at=now()-interval '91 days' where id=$1",
        [formRequest],
      );
      const formCleanup = (
        await role("parent_retention_worker", null, (db) =>
          db.query("select parent_private.parent_claim_cleanup(100) batch"),
        )
      ).rows[0].batch;
      assert.ok(
        formCleanup.artifacts.some((a: { id: string }) => a.id === artifact.id),
      );
      assertionCount++;
      await role("parent_retention_worker", null, (db) =>
        db.query(
          "select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],array[]::uuid[],$3)",
          [
            formCleanup.batchId,
            formCleanup.leaseToken,
            formCleanup.artifacts.map((a: { id: string }) => a.id),
          ],
        ),
      );
      assert.equal(
        (
          await admin.query(
            "select status from public.parent_form_artifacts where id=$1",
            [artifact.id],
          )
        ).rows[0].status,
        "deleted",
      );
      assertionCount++;
      await admin.query(
        "update parent_private.provider_capabilities set requires_form=false where program_id='peco-cap' and action='share'",
      );
      console.log(
        "Known-template binding, immutable form artifacts and form retention SQL passed in the embedded fixture; actual bytes/Storage are not covered.",
      );
    }

    const correctionRequest = await start(),
      correctionJob = await claim(correctionRequest),
      correctionOperation = await prepare(correctionJob);
    await role("authenticated", ownerA, (db) =>
      db.query("select public.parent_correct_request($1,$2,1)", [
        correctionRequest,
        JSON.stringify({ ...intake, householdSize: 4 }),
      ]),
    );
    await denied(() => begin(correctionJob, correctionOperation));
    assert.equal(
      (
        await admin.query(
          "select state from public.parent_operations where id=$1",
          [correctionOperation],
        )
      ).rows[0].state,
      "invalidated",
    );
    assertionCount++;
    await denied(
      () =>
        role("authenticated", ownerA, (db) =>
          db.query("select public.parent_correct_request($1,$2,1)", [
            correctionRequest,
            JSON.stringify(intake),
          ]),
        ),
      "40001",
    );
    const currentJob = await claim(correctionRequest);
    await admin.query("begin");
    try {
      // Hold capacity stable and roll back every probe reservation, including on failure.
      await admin.query("select pg_advisory_xact_lock(627281901)");
      await admin.query(
        "select 1 from parent_private.processing_controls where singleton for update",
      );
      const budgetSnapshotSql = `select
        (select count(*) from parent_private.model_call_reservations) reservations,
        (select count(*) from parent_private.ai_calls) execution_calls,
        (select count(*) from parent_private.assistant_calls) assistant_calls,
        case when c.model_budget_started_at>now() then 0
          when c.model_call_limit is null then 12
          else least(12,greatest(0,c.model_call_limit-greatest(
            (select count(*) from parent_private.model_call_reservations where created_at>=c.model_budget_started_at),
            (select count(*) from parent_private.ai_calls where created_at>=c.model_budget_started_at)
              +(select count(*) from parent_private.assistant_calls where created_at>=c.model_budget_started_at)
          ))) end::integer allowed_calls
        from parent_private.processing_controls c where singleton`;
      const before = (await admin.query(budgetSnapshotSql)).rows[0];
      await admin.query("savepoint ai_budget_probe");
      await admin.query("set local role parent_worker");
      for (let i = 0; i < before.allowed_calls; i++)
        assert.equal(
          (
            await admin.query(
              "select parent_private.parent_reserve_ai_call($1,$2) allowed",
              [currentJob.jobId, currentJob.leaseToken],
            )
          ).rows[0].allowed,
          true,
        );
      assert.equal(
        (
          await admin.query(
            "select parent_private.parent_reserve_ai_call($1,$2) allowed",
            [currentJob.jobId, currentJob.leaseToken],
          )
        ).rows[0].allowed,
        false,
      );
      await admin.query("rollback to savepoint ai_budget_probe");
      assert.deepEqual((await admin.query(budgetSnapshotSql)).rows[0], before);
      assertionCount += 2;
      console.log(
        `AI budget probe passed (${before.allowed_calls} available calls, then denial); all probe reservations rolled back.`,
      );
    } finally {
      await admin.query("rollback");
    }
    await admin.query("delete from auth.sessions where user_id=$1", [ownerA]);
    assert.equal(
      (
        await role("authenticated", ownerA, (db) =>
          db.query("select count(*)::int n from public.parent_requests"),
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query("select public.parent_control_request($1,'cancel')", [
          correctionRequest,
        ]),
      ),
    );
    assert.equal(
      (
        await admin.query("select parent_private.current_grant($1,2) allowed", [
          correctionRequest,
        ])
      ).rows[0].allowed,
      true,
    );
    assertionCount++;
    await admin.query(
      "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
      [sessions.get(ownerA), ownerA],
    );
    console.log(
      "Corrections invalidate queued work, AI budgets bind independently of cookies, and normal sign-out preserves only scoped service authority.",
    );

    if (!fixture) {
      // Simultaneous cancellation/dispatch must serialize without inverted-lock deadlocks.
      const racingRequest = await start(),
        racingJob = await claim(racingRequest),
        racingOperation = await prepare(racingJob);
      const race = await Promise.allSettled([
        role("authenticated", ownerA, (db) =>
          db.query("select public.parent_control_request($1,'cancel')", [
            racingRequest,
          ]),
        ),
        begin(racingJob, racingOperation),
      ]);
      for (const result of race)
        if (result.status === "rejected")
          assert.equal(
            result.reason.code,
            "42501",
            "a race may reject stale dispatch, never deadlock",
          );
      if (race[1].status === "fulfilled")
        await finish(racingJob, racingOperation);
      assert.equal(
        (
          await admin.query(
            "select status from public.parent_requests where id=$1",
            [racingRequest],
          )
        ).rows[0].status,
        "cancelled",
      );
      assertionCount++;
      await denied(() => begin(racingJob, racingOperation));
    } else
      console.log(
        "Concurrent cancellation/dispatch check requires the actual multi-connection database.",
      );

    const document = (
      await role("authenticated", ownerB, (db) =>
        db.query(
          "select * from public.parent_register_document($1,'bill.pdf','application/pdf',400,1,'2026-10-25')",
          [requestB],
        ),
      )
    ).rows[0];
    assert.match(document.object_path, new RegExp(`^${ownerB}/${requestB}/`));
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query("select public.parent_delete_document($1,$2)", [
          requestB,
          document.id,
        ]),
      ),
    );
    await denied(
      () =>
        role("authenticated", ownerB, (db) =>
          db.query(
            "select public.parent_register_document($1,'bill.pdf','application/pdf',400,1,'')",
            [requestB],
          ),
        ),
      "23514",
    );
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_confirm_document_upload($1,$2)", [
          requestB,
          document.id,
        ]),
      ),
    );
    const unconfirmedJob = await claim(requestB);
    assert.ok(
      !unconfirmedJob.documents.some(
        (d: { id: string }) => d.id === document.id,
      ),
    );
    assertionCount++;
    fixtureStoragePaths.set(document.object_path, "parent-documents");
    await role("authenticated", ownerB, (db) =>
      db.query(
        'insert into storage.objects(bucket_id,name,metadata) values(\'parent-documents\',$1,\'{"size":400,"mimetype":"application/pdf"}\')',
        [document.object_path],
      ),
    );
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_confirm_document_upload($1,$2)", [
        requestB,
        document.id,
      ]),
    );
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_confirm_document_upload($1,$2)", [
        requestB,
        document.id,
      ]),
    );
    assert.equal(
      (
        await admin.query(
          "select version from public.parent_requests where id=$1",
          [requestB],
        )
      ).rows[0].version,
      2,
    );
    assertionCount++;
    const documentJob = await claim(requestB);
    const facts = {
      provider: "peco",
      amountDue: 100,
      totalBalance: null,
      dueDate: null,
      shutoffDate: null,
      fields: [
        { field: "provider", page: 1, sourceText: "PECO" },
        { field: "amountDue", page: 1, sourceText: "Amount due $100.00" },
      ],
    };
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5)",
            [
              documentJob.jobId,
              documentJob.leaseToken,
              document.id,
              JSON.stringify(facts),
              [null],
            ],
          ),
        ),
      "42501",
    );
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5)",
            [
              documentJob.jobId,
              documentJob.leaseToken,
              document.id,
              JSON.stringify(facts),
              ["An unrelated page"],
            ],
          ),
        ),
      "23514",
    );
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5)",
        [
          documentJob.jobId,
          documentJob.leaseToken,
          document.id,
          JSON.stringify(facts),
          ["PECO\nAmount due $100.00"],
        ],
      ),
    );
    const checkedDocument = (
      await admin.query(
        "select status,facts,expires_at<=now()+interval '24 hours' bounded from public.parent_documents where id=$1",
        [document.id],
      )
    ).rows[0];
    assert.equal(checkedDocument.status, "validated");
    assert.equal(checkedDocument.facts.length, 2);
    assert.equal(checkedDocument.bounded, true);
    assertionCount += 3;
    await admin.query(
      "update public.parent_documents set expires_at=now()-interval '1 second' where id=$1",
      [document.id],
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,2,'peco-cap','share',$3,array['documents'],array[$4::uuid],$5)",
          [
            documentJob.jobId,
            documentJob.leaseToken,
            JSON.stringify({ documentIds: [document.id] }),
            document.id,
            randomUUID(),
          ],
        ),
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_claim_cleanup(100)"),
      ),
    );
    const rawBatch = (
      await role("parent_retention_worker", null, (db) =>
        db.query("select parent_private.parent_claim_cleanup(100) batch"),
      )
    ).rows[0].batch;
    assert.equal(rawBatch.documents.length, 1);
    assertionCount++;
    await denied(() =>
      role("parent_retention_worker", null, (db) =>
        db.query(
          "select parent_private.parent_finish_cleanup($1,$2,$3,array[]::uuid[])",
          [rawBatch.batchId, randomUUID(), [document.id]],
        ),
      ),
    );
    await role("parent_retention_worker", null, (db) =>
      db.query(
        "select parent_private.parent_finish_cleanup($1,$2,$3,array[]::uuid[])",
        [rawBatch.batchId, rawBatch.leaseToken, [document.id]],
      ),
    );
    const retainedFactsJob = await claim(requestB);
    assert.ok(
      retainedFactsJob.documents.some(
        (d: {
          id: string;
          object_path: string | null;
          raw_available: boolean;
        }) =>
          d.id === document.id &&
          d.object_path === null &&
          d.raw_available === false,
      ),
    );
    assertionCount++;
    const expiredDocument = (
      await admin.query(
        "select status,facts from public.parent_documents where id=$1",
        [document.id],
      )
    ).rows[0];
    assert.equal(expiredDocument.status, "raw_deleted");
    assert.equal(expiredDocument.facts.length, 2);
    assertionCount += 2;
    await admin.query(
      "update public.parent_documents set facts_valid_until=now()-interval '1 second' where id=$1",
      [document.id],
    );
    await role("parent_retention_worker", null, (db) =>
      db.query("select parent_private.parent_claim_cleanup(100)"),
    );
    assert.deepEqual(
      (
        await admin.query(
          "select facts from public.parent_documents where id=$1",
          [document.id],
        )
      ).rows[0].facts,
      [],
    );
    assertionCount++;

    // Required factual answers update the fact, invalidate stale work and survive a rerun.
    await admin.query(
      `update public.parent_requests set intake=jsonb_set(intake,'{accountAuthority}','"not_sure"'),required_actions='[{"id":"account-authority","need":"electricity","reason":"missing_fact","title":"Account holder","explanation":"Authority is required","field":"accountAuthority"}]' where id=$1`,
      [requestB],
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_resolve_action($1,'account-authority','self')",
        [requestB],
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select (select f->>'value' from jsonb_array_elements(facts) f where f->>'field'='accountAuthority' and f->>'need'='electricity') authority,version from public.parent_requests where id=$1",
          [requestB],
        )
      ).rows[0].authority,
      "self",
    );
    assertionCount++;

    // Exact manual answers and current scope bind both extraction and raw-byte access.
    const resumeRequest = await start(ownerB, randomUUID(), {
      ...intake,
      contactPreference: "email",
    });
    assert.equal(
      (
        await admin.query(
          "select preferences->>'contactPreference' value from public.parent_accounts where id=$1",
          [ownerB],
        )
      ).rows[0].value,
      "email",
    );
    assertionCount++;
    let resumeJob = await claim(resumeRequest);
    const quarantined = (
      await role("authenticated", ownerB, (db) =>
        db.query(
          "select * from public.parent_register_document($1,'current-bill.pdf','application/pdf',400,null,'2026-10-25')",
          [resumeRequest],
        ),
      )
    ).rows[0];
    assert.equal(quarantined.page_count, null);
    fixtureStoragePaths.set(quarantined.object_path, "parent-documents");
    assertionCount++;
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download')",
          [resumeJob.jobId, resumeJob.leaseToken, quarantined.object_path],
        ),
      ),
    );
    await denied(() =>
      role("parent_storage_broker", null, (db) =>
        db.query(
          "select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download') value",
          [resumeJob.jobId, resumeJob.leaseToken, quarantined.object_path],
        ),
      ),
    );
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query(
          "insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":401}')",
          [quarantined.object_path],
        ),
      ),
    );
    await denied(() =>
      role("authenticated", ownerA, (db) =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('parent-documents',$1)",
          [quarantined.object_path],
        ),
      ),
    );
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query(
          'insert into storage.objects(bucket_id,name,metadata) values(\'parent-documents\',$1,\'{"size":400,"mimetype":"image/png"}\')',
          [quarantined.object_path],
        ),
      ),
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('parent-documents',$1)",
        [quarantined.object_path],
      ),
    );
    assert.equal(
      (
        await role("authenticated", ownerB, (db) =>
          db.query("select id from storage.objects where name=$1", [
            quarantined.object_path,
          ]),
        )
      ).rows.length,
      0,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_confirm_document_upload($1,$2)", [
          resumeRequest,
          quarantined.id,
        ]),
      ),
    );
    await admin.query(
      'update storage.objects set metadata=\'{"size":401,"mimetype":"application/pdf"}\' where name=$1',
      [quarantined.object_path],
    );
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_confirm_document_upload($1,$2)", [
          resumeRequest,
          quarantined.id,
        ]),
      ),
    );
    await removeFixtureStorageMetadata(
      "parent-documents",
      quarantined.object_path,
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        'insert into storage.objects(bucket_id,name,metadata) values(\'parent-documents\',$1,\'{"size":400,"mimetype":"application/pdf"}\')',
        [quarantined.object_path],
      ),
    );
    const directDelete = () =>
      role("authenticated", ownerB, (db) =>
        db.query(
          "delete from storage.objects where bucket_id='parent-documents' and name=$1 returning id",
          [quarantined.object_path],
        ),
      );
    if (fixture) {
      assert.equal((await directDelete()).rows.length, 0);
      assertionCount++;
    } else {
      // Actual Storage rejects the statement before row policies can filter it.
      await denied(directDelete);
    }
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from storage.objects where name=$1",
          [quarantined.object_path],
        )
      ).rows[0].n,
      1,
    );
    assertionCount++;
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_confirm_document_upload($1,$2)", [
        resumeRequest,
        quarantined.id,
      ]),
    );
    assert.equal(
      (
        await role("authenticated", ownerB, (db) =>
          db.query("select id from storage.objects where name=$1", [
            quarantined.object_path,
          ]),
        )
      ).rows.length,
      1,
    );
    assertionCount++;
    resumeJob = await claim(resumeRequest);
    assert.equal(
      (
        await role("parent_storage_broker", null, (db) =>
          db.query(
            "select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download') value",
            [resumeJob.jobId, resumeJob.leaseToken, quarantined.object_path],
          ),
        )
      ).rows[0].value.maxBytes,
      400,
    );
    assertionCount++;
    await denied(
      () =>
        role("authenticated", ownerB, (db) =>
          db.query(
            "select public.parent_answer_fact($1,'food_now','amountDue','10',2)",
            [resumeRequest],
          ),
        ),
      "23514",
    );
    await denied(
      () =>
        role("authenticated", ownerB, (db) =>
          db.query(
            "select public.parent_answer_fact($1,'electricity','amountDue','-1',2)",
            [resumeRequest],
          ),
        ),
      "23514",
    );
    await denied(
      () =>
        role("authenticated", ownerB, (db) =>
          db.query(
            "select public.parent_answer_fact($1,'electricity','amountDue','10',null)",
            [resumeRequest],
          ),
        ),
      "40001",
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_answer_fact($1,'electricity','amountDue','100',2)",
        [resumeRequest],
      ),
    );
    const manual = (
      await admin.query(
        "select version,facts from public.parent_requests where id=$1",
        [resumeRequest],
      )
    ).rows[0];
    assert.equal(manual.version, 3);
    assert.equal(manual.facts[0].source, "parent");
    assertionCount += 2;
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_renew_job_lease($1,$2)", [
          resumeJob.jobId,
          resumeJob.leaseToken,
        ]),
      ),
    );
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_replace_mandate($1,$2,3)", [
        resumeRequest,
        JSON.stringify({
          ...mandate,
          allowedData: ["household", "income", "utility"],
        }),
      ]),
    );
    const withdrawnJob = await claim(resumeRequest);
    await denied(() =>
      role("parent_storage_broker", null, (db) =>
        db.query(
          "select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download')",
          [
            withdrawnJob.jobId,
            withdrawnJob.leaseToken,
            quarantined.object_path,
          ],
        ),
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5,1)",
          [
            withdrawnJob.jobId,
            withdrawnJob.leaseToken,
            quarantined.id,
            JSON.stringify(facts),
            ["PECO\nAmount due $100.00"],
          ],
        ),
      ),
    );
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_replace_mandate($1,$2,4)", [
        resumeRequest,
        JSON.stringify(mandate),
      ]),
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_answer_fact($1,'food_now','income',$2,5)",
        [resumeRequest, JSON.stringify({ amount: 0, frequency: "monthly" })],
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select intake->>'incomeAmount' amount,version from public.parent_requests where id=$1",
          [resumeRequest],
        )
      ).rows[0].amount,
      "0",
    );
    assertionCount++;
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_update_booking_preference($1,'any_weekday',6)",
        [resumeRequest],
      ),
    );
    const finalJob = await claim(resumeRequest);
    const billDate = new Date().toISOString().slice(0, 10);
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5,1,$6)",
        [
          finalJob.jobId,
          finalJob.leaseToken,
          quarantined.id,
          JSON.stringify(facts),
          [`Bill date ${billDate}\nPECO\nAmount due $100.00`],
          billDate,
        ],
      ),
    );
    const sourceMetadata = (
      await admin.query(
        "select source_observed_at is not null source,facts_valid_until>now()+interval '1 day' reusable from public.parent_documents where id=$1",
        [quarantined.id],
      )
    ).rows[0];
    assert.deepEqual(sourceMetadata, { source: true, reusable: true });
    assertionCount++;
    for (let index = 0; index < 9; index++)
      await role("authenticated", ownerB, (db) =>
        db.query(
          "select public.parent_register_document($1,'quota.pdf','application/pdf',400,null,'2026-10-25')",
          [resumeRequest],
        ),
      );
    await denied(
      () =>
        role("authenticated", ownerB, (db) =>
          db.query(
            "select public.parent_register_document($1,'over-quota.pdf','application/pdf',400,null,'2026-10-25')",
            [resumeRequest],
          ),
        ),
      "P0001",
    );
    const combinedUtilityIntake = {
      ...intake,
      needs: ["electricity", "gas"],
      utilityProviders: ["peco", "pgw"],
      accountAuthority: "not_sure",
    };
    const combinedUtilityMandate = {
      ...mandate,
      recipientIds: ["peco-cap", "pgw-crp", "uesf-utilities"],
      maxRecipients: 3,
    };
    await denied(
      () =>
        start(
          ownerB,
          randomUUID(),
          { ...combinedUtilityIntake, shutoffDate: billDate },
          combinedUtilityMandate,
        ),
      "23514",
    );
    const combinedUtilityRequest = await start(
      ownerB,
      randomUUID(),
      combinedUtilityIntake,
      combinedUtilityMandate,
    );
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_answer_fact($1,'electricity','accountAuthority','\"self\"',1)",
        [combinedUtilityRequest],
      ),
    );
    const combinedAuthority = (
      await admin.query(
        "select intake->>'accountAuthority' authority,intake->'utilityProviders' providers from public.parent_requests where id=$1",
        [combinedUtilityRequest],
      )
    ).rows[0];
    assert.deepEqual(combinedAuthority, {
      authority: "not_sure",
      providers: ["peco", "pgw"],
    });
    assertionCount++;
    await admin.query(
      "update parent_private.provider_capabilities set allowed_fields=array['amountDue','accountAuthority'],field_categories='{\"amountDue\":\"utility\",\"accountAuthority\":\"utility\"}' where program_id='peco-cap' and action='share'",
    );
    await admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,verified_until,allowed_fields,field_categories,required_acts) values('pgw-crp','share',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['amountDue'],'{\"amountDue\":\"utility\"}',array[]::text[])",
    );
    const combinedUtilityJob = await claim(combinedUtilityRequest);
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_prepare_operation($1,$2,2,'peco-cap','share','{\"amountDue\":10}',array['utility'],array[]::uuid[],$3,'electricity')",
        [combinedUtilityJob.jobId, combinedUtilityJob.leaseToken, randomUUID()],
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,2,'pgw-crp','share','{\"amountDue\":10}',array['utility'],array[]::uuid[],$3,'gas')",
          [
            combinedUtilityJob.jobId,
            combinedUtilityJob.leaseToken,
            randomUUID(),
          ],
        ),
      ),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,2,'peco-cap','share','{\"amountDue\":10,\"accountAuthority\":\"authorized_caregiver\"}',array['utility'],array[]::uuid[],$3,'electricity')",
          [
            combinedUtilityJob.jobId,
            combinedUtilityJob.leaseToken,
            randomUUID(),
          ],
        ),
      ),
    );
    const uncertainOperation = (
      await admin.query(
        "select id from public.parent_operations where request_id=$1 and need='electricity' and state='prepared'",
        [combinedUtilityRequest],
      )
    ).rows[0].id;
    await begin(combinedUtilityJob, uncertainOperation);
    await finish(combinedUtilityJob, uncertainOperation, "delivery_unknown", {
      source: "provider_api",
      reference: "fixture-uncertain-delivery",
    });
    await role("authenticated", ownerB, (db) =>
      db.query(
        "select public.parent_answer_fact($1,'gas','accountAuthority','\"self\"',2)",
        [combinedUtilityRequest],
      ),
    );
    const independentJob = await claim(combinedUtilityRequest);
    await admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,verified_until,allowed_fields,field_categories,required_acts) values('uesf-utilities','share',true,true,'synthetic-security-test','isolated synthetic fixture',now()+interval '1 hour',array['amountDue'],'{\"amountDue\":\"utility\"}',array[]::text[])",
    );
    const sameNeedAlternative = (
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,3,'uesf-utilities','share','{\"amountDue\":10}',array['utility'],array[]::uuid[],$3,'electricity') id",
          [independentJob.jobId, independentJob.leaseToken, randomUUID()],
        ),
      )
    ).rows[0].id;
    await denied(() => begin(independentJob, sameNeedAlternative), "23514");
    const independentGas = (
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_prepare_operation($1,$2,3,'pgw-crp','share','{\"amountDue\":10}',array['utility'],array[]::uuid[],$3,'gas') id",
          [independentJob.jobId, independentJob.leaseToken, randomUUID()],
        ),
      )
    ).rows[0].id;
    await begin(independentJob, independentGas);
    await finish(independentJob, independentGas, "sent", {
      source: "provider_api",
      reference: "fixture-independent-gas",
    });
    assert.equal(
      (
        await admin.query(
          "select state from public.parent_operations where id=$1",
          [independentGas],
        )
      ).rows[0].state,
      "sent",
    );
    assertionCount++;
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_save_job_plan($1,$2,3,'{\"version\":1,\"routes\":[]}','[]',null,'operator','provider_capability_enabled')",
        [independentJob.jobId, independentJob.leaseToken],
      ),
    );
    await admin.query(
      "update parent_private.provider_capabilities set transport_verified=false where program_id='uesf-utilities' and action='share'",
    );
    await admin.query(
      "update parent_private.provider_capabilities set transport_verified=true where program_id='uesf-utilities' and action='share'",
    );
    assert.equal(
      (
        await admin.query(
          "select state from public.parent_jobs where request_id=$1",
          [combinedUtilityRequest],
        )
      ).rows[0].state,
      "queued",
    );
    assertionCount++;
    // Keep the active finalJob lease for notification tests (the helper intentionally sidelines other jobs).
    await admin.query(
      "update public.parent_jobs set state='leased' where id=$1",
      [finalJob.jobId],
    );
    // Safe durable notices derive the current verified address only at final dispatch.
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_update_preferences($1)", [
        JSON.stringify({
          contactPreference: "email",
          language: "en",
          quietHoursStart: 0,
          quietHoursEnd: 0,
        }),
      ]),
    );
    const noticeEvent = (key: string) => ({
      id: key.repeat(64),
      kind: "support.prepared",
      need: "food_now",
      programId: "philly-food",
      summary: "private model text must not enter an email preview",
    });
    const recordNotice = async (key: string) =>
      role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_record_service_event($1,$2,$3) id",
          [
            finalJob.jobId,
            finalJob.leaseToken,
            JSON.stringify(noticeEvent(key)),
          ],
        ),
      );
    const firstNotice = await recordNotice("a");
    assert.equal((await recordNotice("a")).rows[0].id, firstNotice.rows[0].id);
    assertionCount++;
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from parent_private.notification_outbox where request_id=$1",
          [resumeRequest],
        )
      ).rows[0].n,
      1,
    );
    assertionCount++;
    assert.equal(
      (
        await admin.query(
          "select summary from public.parent_events where id=$1",
          [firstNotice.rows[0].id],
        )
      ).rows[0].summary,
      "Your support request has a new update.",
    );
    assertionCount++;
    await denied(
      () =>
        role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_record_service_event($1,$2,$3)",
            [
              finalJob.jobId,
              finalJob.leaseToken,
              JSON.stringify({ id: "f".repeat(64) }),
            ],
          ),
        ),
      "23514",
    );
    const notification = (
      await role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_claim_notification() value"),
      )
    ).rows[0].value;
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_update_preferences($1)", [
        JSON.stringify({
          contactPreference: "in_app",
          language: "en",
          quietHoursStart: 0,
          quietHoursEnd: 0,
        }),
      ]),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_begin_notification($1,$2)", [
          notification.notificationId,
          notification.leaseToken,
        ]),
      ),
    );
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_update_preferences($1)", [
        JSON.stringify({
          contactPreference: "email",
          language: "en",
          quietHoursStart: 0,
          quietHoursEnd: 0,
        }),
      ]),
    );
    const preview = (
      await role("parent_worker", null, (db) =>
        db.query(
          "select parent_private.parent_begin_notification($1,$2) value",
          [notification.notificationId, notification.leaseToken],
        ),
      )
    ).rows[0].value;
    assert.equal(preview.requestPath, `/support/${resumeRequest}`);
    assert.equal(preview.recipient, `parent-fixture-${ownerB}@example.test`);
    assert.equal(preview.summary, undefined);
    assertionCount += 3;
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_finish_notification($1,$2,'sent','fixture-mail-1')",
        [notification.notificationId, notification.leaseToken],
      ),
    );
    await recordNotice("b");
    const unknownNotice = (
      await role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_claim_notification() value"),
      )
    ).rows[0].value;
    await role("parent_worker", null, (db) =>
      db.query("select parent_private.parent_begin_notification($1,$2)", [
        unknownNotice.notificationId,
        unknownNotice.leaseToken,
      ]),
    );
    await admin.query(
      "update parent_private.notification_outbox set lease_until=now()-interval '1 second' where id=$1",
      [unknownNotice.notificationId],
    );
    assert.equal(
      (
        await role("parent_worker", null, (db) =>
          db.query("select parent_private.parent_claim_notification() value"),
        )
      ).rows[0].value.state,
      "delivery_unknown",
    );
    assertionCount++;
    assert.equal(
      (
        await role("parent_worker", null, (db) =>
          db.query("select parent_private.parent_claim_notification() value"),
        )
      ).rows[0].value,
      null,
    );
    assertionCount++;
    assert.equal(
      (
        await role("parent_worker", null, (db) =>
          db.query(
            "select parent_private.parent_get_unknown_notifications(10) value",
          ),
        )
      ).rows[0].value.length,
      1,
    );
    assertionCount++;
    await role("parent_worker", null, (db) =>
      db.query(
        "select parent_private.parent_reconcile_notification($1,'sent','fixture-mail-2')",
        [unknownNotice.notificationId],
      ),
    );
    for (const [when, due] of [
      ["2026-11-01T04:30:00Z", "2026-11-01T14:00:00Z"],
      ["2026-03-08T06:30:00Z", "2026-03-08T13:00:00Z"],
    ]) {
      assert.equal(
        new Date(
          (
            await admin.query(
              'select parent_private.notification_due_at($1,\'{"quietHoursStart":19,"quietHoursEnd":9}\') value',
              [when],
            )
          ).rows[0].value,
        ).toISOString(),
        new Date(due).toISOString(),
      );
      assertionCount++;
    }
    await recordNotice("c");
    const cancelledNotice = (
      await role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_claim_notification() value"),
      )
    ).rows[0].value;
    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_control_request($1,'pause')", [
        resumeRequest,
      ]),
    );
    await denied(() =>
      role("parent_worker", null, (db) =>
        db.query("select parent_private.parent_begin_notification($1,$2)", [
          cancelledNotice.notificationId,
          cancelledNotice.leaseToken,
        ]),
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select state from parent_private.notification_outbox where id=$1",
          [cancelledNotice.notificationId],
        )
      ).rows[0].state,
      "cancelled",
    );
    assertionCount++;
    console.log(
      "Manual answers, mandate replacement, upload quotas, scoped broker access, safe notice deduplication, opt-out, unknown-delivery reconciliation and DST quiet hours passed.",
    );

    await role("authenticated", ownerB, (db) =>
      db.query("select public.parent_request_deletion()"),
    );
    assert.equal(
      (
        await admin.query(
          "select status from public.parent_accounts where id=$1",
          [ownerB],
        )
      ).rows[0].status,
      "deletion_requested",
    );
    assertionCount++;
    assert.equal(
      (
        await admin.query("select parent_private.current_grant($1,1) allowed", [
          requestB,
        ])
      ).rows[0].allowed,
      false,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    const deletionBatch = (
      await role("parent_retention_worker", null, (db) =>
        db.query("select parent_private.parent_claim_cleanup(100) batch"),
      )
    ).rows[0].batch;
    await role("parent_retention_worker", null, (db) =>
      db.query("select parent_private.parent_finish_cleanup($1,$2,$3,$4)", [
        deletionBatch.batchId,
        deletionBatch.leaseToken,
        deletionBatch.documents.map((d: { id: string }) => d.id),
        deletionBatch.accountIds,
      ]),
    );
    // A second batch picks up the account once its last raw file has been erased.
    const accountBatch = (
      await role("parent_retention_worker", null, (db) =>
        db.query("select parent_private.parent_claim_cleanup(100) batch"),
      )
    ).rows[0].batch;
    if (accountBatch)
      await role("parent_retention_worker", null, (db) =>
        db.query("select parent_private.parent_finish_cleanup($1,$2,$3,$4)", [
          accountBatch.batchId,
          accountBatch.leaseToken,
          accountBatch.documents.map((d: { id: string }) => d.id),
          accountBatch.accountIds,
        ]),
      );
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.parent_accounts where id=$1",
          [ownerB],
        )
      ).rows[0].n,
      0,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    // Simulate an old backup restoring the account: tombstones stop both interactive and durable access immediately.
    await admin.query("insert into public.parent_accounts(id) values($1)", [
      ownerB,
    ]);
    assert.equal(
      (
        await role("authenticated", ownerB, (db) =>
          db.query("select public.is_parent_session() allowed"),
        )
      ).rows[0].allowed,
      false,
    );
    assertionCount++;
    await denied(() =>
      role("authenticated", ownerB, (db) =>
        db.query("select public.parent_ensure_account()"),
      ),
    );
    console.log(
      "Document consent/provenance, expired attachment denial, raw retention, atomic factual answers, deletion and restore tombstones passed.",
    );
    const scopedRequest = await start();
    for (const [need, field, value, version] of [
      ["food_now", "zip", "19103", 1],
      ["food_now", "income", { amount: 1000, frequency: "monthly" }, 2],
      ["electricity", "zip", "19102", 3],
      ["electricity", "income", { amount: 400, frequency: "weekly" }, 4],
    ] as const)
      await role("authenticated", ownerA, (db) => db.query(
        "select public.parent_answer_fact($1,$2,$3,$4,$5)",
        [scopedRequest, need, field, JSON.stringify(value), version],
      ));
    const scoped = (await admin.query(
      "select facts,parent_private.current_intake_fields(id,'food_now') food,parent_private.current_intake_fields(id,'electricity') electric from public.parent_requests where id=$1",
      [scopedRequest],
    )).rows[0];
    assert.equal(scoped.facts.length, 4);
    assertionCount++;
    assert.deepEqual(scoped.food, { zip: "19103", householdSize: 3, incomeAmount: 1000, incomeFrequency: "monthly" });
    assertionCount++;
    assert.deepEqual(scoped.electric, { zip: "19102", householdSize: 3, incomeAmount: 400, incomeFrequency: "weekly" });
    assertionCount++;
    const bundledRequest = await start();
    const bundle = [
      { need: "food_now", field: "zip", value: "19103" },
      { need: "electricity", field: "householdSize", value: 4 },
    ];
    await role("authenticated", ownerA, (db) => db.query(
      "select public.parent_answer_facts($1,$2,1)", [bundledRequest, JSON.stringify(bundle)],
    ));
    const bundleSnapshot = async () => (await admin.query(
      "select to_jsonb(r) value from public.parent_requests r where id=$1", [bundledRequest],
    )).rows[0].value;
    const bundled = await bundleSnapshot();
    assert.equal(bundled.version, 3);
    assertionCount++;
    assert.equal(bundled.facts.length, 2);
    assertionCount++;
    await denied(() => role("authenticated", ownerA, (db) => db.query(
      "select public.parent_answer_facts($1,$2,1)", [bundledRequest, JSON.stringify(bundle)],
    )), "40001");
    await denied(() => role("authenticated", ownerA, (db) => db.query(
      "select public.parent_answer_facts($1,$2,3)", [bundledRequest, JSON.stringify([
        { need: "food_now", field: "zip", value: "19102" },
        { need: "electricity", field: "amountDue", value: -1 },
      ])],
    )), "23514");
    assert.deepEqual(await bundleSnapshot(), bundled);
    assertionCount++;
    if (!fixture) {
      const concurrentRequest = await start();
      const attempts = await Promise.allSettled([2, 4].map((size) =>
        role("authenticated", ownerA, (db) => db.query(
          "select public.parent_answer_facts($1,$2,1)", [concurrentRequest, JSON.stringify([
            { need: "food_now", field: "householdSize", value: size },
            { need: "electricity", field: "amountDue", value: size * 10 },
          ])],
        )),
      ));
      assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
      assertionCount++;
      const rejected = attempts.find((attempt) => attempt.status === "rejected");
      assert.equal(rejected?.status === "rejected" ? rejected.reason.code : null, "40001");
      assertionCount++;
      const saved = (await admin.query("select facts,version from public.parent_requests where id=$1", [concurrentRequest])).rows[0];
      assert.equal(saved.version, 3);
      assertionCount++;
      assert.equal(saved.facts.find((fact: { field: string }) => fact.field === "amountDue").value,
        saved.facts.find((fact: { field: string }) => fact.field === "householdSize").value * 10);
      assertionCount++;
    }
    console.log(
      `Parent database security passed (${assertionCount} recorded assertions, plus bounded budget checks; concurrency ${fixture ? "not run" : "passed"}).`,
    );
  } finally {
    try {
      for (const [path, bucket] of fixtureStoragePaths)
        await removeFixtureStorageMetadata(bucket, path);
      await admin.query(
        "delete from parent_private.provider_capabilities where permission_version='synthetic-security-test'",
      );
      await admin.query("delete from public.families where id=$1", [
        schoolFamily,
      ]);
      await admin.query("delete from auth.users where id=any($1::uuid[])", [
        users,
      ]);
    } finally {
      try {
        if (!fixture && originalControls) {
          const errors: unknown[] = [];
          try {
            await admin.query(
              "update parent_private.processing_controls c set (enabled,approval_reference,approved_until,updated_at,existing_accounts_enabled,snap_details_enabled,snap_details_approval_reference,snap_details_approved_until,snap_details_notice_version)=(select r.enabled,r.approval_reference,r.approved_until,r.updated_at,r.existing_accounts_enabled,r.snap_details_enabled,r.snap_details_approval_reference,r.snap_details_approved_until,r.snap_details_notice_version from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) r) where singleton",
              [JSON.stringify(originalControls)],
            );
          } catch (error) {
            errors.push(error);
          }
          for (const membership of changedMemberships.reverse()) {
            try {
              await admin.query(
                membership.existed
                  ? `grant ${identifier(membership.name)} to ${identifier(operatorName)} with set ${membership.set ? "true" : "false"}`
                  : `revoke ${identifier(membership.name)} from ${identifier(operatorName)} granted by ${identifier(operatorName)}`,
              );
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length)
            throw new AggregateError(
              errors,
              "The isolated fixture could not restore its processing controls or role settings.",
            );
          assert.deepEqual(
            (
              await admin.query(
                "select to_jsonb(c) value from parent_private.processing_controls c where singleton",
              )
            ).rows[0].value,
            originalControls,
          );
          assert.deepEqual(await memberships(), originalMemberships);
          console.log(
            "Actual fixture processing controls and role memberships restored exactly.",
          );
        }
      } finally {
        await pool.end();
        await admin.end();
      }
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

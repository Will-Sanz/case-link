import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { supportProgressSchema } from "./progress";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("actual parent worker progress boundaries", () => {
  it("reports actual leases/health, expires honestly and denies cross-household reads and forged health", async () => {
    const fixture = await createParentSqlFixture(modulePath!);
    const db = fixture.admin,
      owner = randomUUID(),
      session = randomUUID();
    async function parent(sql: string, values: unknown[] = []) {
      await db.query("set role authenticated");
      try {
        await db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: owner,
            session_id: session,
            role: "authenticated",
            amr: [{ method: "otp" }],
          }),
        ]);
        return await db.query(sql, values);
      } finally {
        await db.query("reset role");
      }
    }
    try {
      await db.query(
        "update parent_private.processing_controls set enabled=true,approval_reference='Synthetic progress check',approved_until=now()+interval '1 day'",
      );
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'progress@example.test',now())",
        [owner],
      );
      await db.query(
        "insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')",
        [session, owner],
      );
      const requestId = (
        await parent("select public.parent_start_request($1,$2,$3) id", [
          JSON.stringify(fixtureIntake()),
          JSON.stringify(
            fixtureMandate({
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            }),
          ),
          randomUUID(),
        ])
      ).rows[0].id;
      const read = async () =>
        supportProgressSchema.parse(
          (
            await parent("select public.parent_request_progress($1) value", [
              requestId,
            ])
          ).rows[0].value,
        );
      expect((await read()).state).toBe("service_offline");
      await expect(
        parent("select parent_private.parent_record_worker_health(true,true)"),
      ).rejects.toHaveProperty("code", "42501");
      await db.query("set role parent_worker");
      await db.query(
        "select parent_private.parent_record_worker_health(true,true)",
      );
      await db.query("reset role");
      expect(await read()).toMatchObject({
        state: "queued",
        canContinueAfterClosing: true,
      });
      await db.query(
        "update public.parent_jobs set state='leased',lease_until=now()+interval '1 minute' where request_id=$1",
        [requestId],
      );
      expect((await read()).state).toBe("running");
      await db.query(
        "update parent_private.worker_health set expires_at=now()-interval '1 second'",
      );
      expect(await read()).toMatchObject({
        state: "service_offline",
        canContinueAfterClosing: false,
      });
      await db.query(
        "update parent_private.worker_health set expires_at=now()+interval '1 minute'",
      );
      await db.query(
        "update public.parent_jobs set state='waiting',run_at='infinity' where request_id=$1",
        [requestId],
      );
      await db.query(
        "update public.parent_requests set required_actions=$2,next_actor='service_operator' where id=$1",
        [
          requestId,
          JSON.stringify([
            {
              id: "operator",
              title: "Connect",
              explanation: "Connection needed",
              resolver: "operator",
              resolved: false,
            },
            {
              id: "done",
              title: "Done",
              explanation: "Already answered",
              resolved: true,
            },
          ]),
        ],
      );
      expect(await read()).toMatchObject({ state: "waiting", nextRunAt: null });
      await db.query(
        "update public.parent_requests set required_actions=$2 where id=$1",
        [
          requestId,
          JSON.stringify([
            {
              id: "parent",
              title: "A fact",
              explanation: "A fact needed",
              resolved: false,
            },
          ]),
        ],
      );
      expect((await read()).state).toBe("needs_parent");
      await parent("select public.parent_control_request($1,'pause')", [
        requestId,
      ]);
      expect(await read()).toMatchObject({
        state: "paused",
        canContinueAfterClosing: false,
      });
      await parent("select public.parent_control_request($1,'cancel')", [
        requestId,
      ]);
      expect(await read()).toMatchObject({
        state: "cancelled",
        canContinueAfterClosing: false,
      });
      await expect(
        parent("select public.parent_request_progress($1)", [randomUUID()]),
      ).rejects.toHaveProperty("code", "42501");
      const all = (
        await parent("select public.parent_all_request_progress() value")
      ).rows[0].value;
      expect(Object.keys(all as object)).toEqual([requestId]);
      await db.query(
        "update parent_private.processing_controls set enabled=false",
      );
      await expect(
        parent("select public.parent_request_progress($1)", [requestId]),
      ).rejects.toHaveProperty("code", "42501");
    } finally {
      await db.query("reset role");
      await db.end();
    }
  }, 30000);
});

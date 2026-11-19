import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)(
  "parent assistant database trust boundaries",
  () => {
    it("enforces owned read-only turns, live-worker availability, fresh consent, idempotency and independent revocation", async () => {
      const { admin } = await createParentSqlFixture(modulePath!);
      const owner = randomUUID(),
        other = randomUUID(),
        household = randomUUID(),
        request = randomUUID(),
        session = randomUUID();
      const asOwner = async () => {
        await admin.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: owner,
            session_id: session,
            amr: [{ method: "password" }],
          }),
        ]);
        await admin.query("set role authenticated");
      };
      try {
        await admin.query(
          "update parent_private.processing_controls set enabled=true,approval_reference='synthetic-assistant-test',approved_until=now()+interval '1 day'",
        );
        await admin.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic-assistant@example.invalid',now()),($2,'synthetic-other@example.invalid',now())",
          [owner, other],
        );
        await admin.query(
          "insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())",
          [session, owner],
        );
        await admin.query(
          "insert into public.parent_accounts(id) values($1),($2)",
          [owner, other],
        );
        await admin.query(
          "insert into public.parent_households(id,owner_id) values($1,$2)",
          [household, owner],
        );
        await admin.query(
          "insert into public.parent_requests(id,household_id,intake,mandate,status) values($1,$2,$3,$4,'cancelled')",
          [
            request,
            household,
            JSON.stringify(fixtureIntake()),
            JSON.stringify(fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() })),
          ],
        );
        await asOwner();
        expect(
          (
            await admin.query(
              "select public.parent_assistant_available($1) value",
              [request],
            )
          ).rows[0].value,
        ).toBe(false);
        await expect(
          admin.query(
            "select public.parent_ask_assistant($1,'What happened?',$2,true)",
            [request, randomUUID()],
          ),
        ).rejects.toThrow("assistant_unavailable");
        await admin.query("reset role");
        await admin.query("set role parent_worker");
        await admin.query(
          "select parent_private.parent_record_worker_health(false,true)",
        );
        await admin.query("reset role");
        await asOwner();
        for (const secret of [
          "123-45-6789",
          "123456789",
          "identifierABC123456789",
          "123.45.6789",
          "123  45  6789",
          "123/45/6789",
          "215-555-0123",
          "123 Example Street",
          "DOB: 2000-01-01",
          "１２３－４５－６７８９",
          "123–45–6789",
          "Password: private",
          "PIN is 1234",
          "SSN: secret",
          "person@example.invalid",
        ])
          await expect(
            admin.query("select public.parent_ask_assistant($1,$2,$3,true)", [
              request,
              secret,
              randomUUID(),
            ]),
          ).rejects.toThrow("assistant_question_invalid");
        await expect(
          admin.query(
            "select public.parent_ask_assistant($1,'Question',$2,false)",
            [request, randomUUID()],
          ),
        ).rejects.toThrow("assistant_question_invalid");
        const key = randomUUID();
        const message = (
          await admin.query(
            "select public.parent_ask_assistant($1,'What is happening?',$2,true) value",
            [request, key],
          )
        ).rows[0].value;
        expect(
          (
            await admin.query(
              "select public.parent_ask_assistant($1,'What is happening?',$2,true) value",
              [request, key],
            )
          ).rows[0].value,
        ).toBe(message);
        await expect(
          admin.query(
            "select public.parent_ask_assistant($1,'Changed question',$2,true)",
            [request, key],
          ),
        ).rejects.toThrow("assistant_question_invalid");
        await expect(
          admin.query(
            "select public.parent_ask_assistant($1,'Another question',$2,true)",
            [request, randomUUID()],
          ),
        ).rejects.toThrow("assistant_pending");
        expect(
          (
            await admin.query(
              "select question from public.parent_assistant_messages where request_id=$1",
              [request],
            )
          ).rows,
        ).toEqual([{ question: "What is happening?" }]);
        await expect(
          admin.query(
            "select lease_token from public.parent_assistant_messages",
          ),
        ).rejects.toThrow("permission denied");
        await expect(
          admin.query("select parent_private.parent_claim_assistant()"),
        ).rejects.toThrow("permission denied");
        await admin.query("reset role");
        await admin.query("set role parent_worker");
        const claim = (
          await admin.query(
            "select parent_private.parent_claim_assistant() value",
          )
        ).rows[0].value as Record<string, unknown>;
        expect(claim.messageId).toBe(message);
        expect((claim.request as Record<string, unknown>).status).toBe(
          "cancelled",
        );
        expect(claim).not.toHaveProperty("email");
        expect(claim).not.toHaveProperty("object_path");
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_assistant_call($1,$2) value",
              [message, claim.leaseToken],
            )
          ).rows[0].value,
        ).toBe(true);
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_assistant_call($1,$2) value",
              [message, claim.leaseToken],
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query("reset role");
        await asOwner();
        await admin.query("select public.parent_cancel_assistant($1,$2)", [
          request,
          message,
        ]);
        await admin.query("reset role");
        await admin.query("set role parent_worker");
        await expect(
          admin.query(
            "select parent_private.parent_finish_assistant($1,$2,$3::jsonb)",
            [
              message,
              claim.leaseToken,
              JSON.stringify({
                intro: "Status",
                paragraphs: [],
                actionIds: [],
              }),
            ],
          ),
        ).rejects.toThrow("authority changed");
        await admin.query("reset role");
        await asOwner();
        const next = (
          await admin.query(
            "select public.parent_ask_assistant($1,'Why is it cancelled?',$2,true) value",
            [request, randomUUID()],
          )
        ).rows[0].value;
        await admin.query("reset role");
        await admin.query(
          "update public.parent_requests set version=version+1 where id=$1",
          [request],
        );
        await admin.query("set role parent_worker");
        expect(
          (
            await admin.query(
              "select parent_private.parent_claim_assistant() value",
            )
          ).rows[0].value,
        ).toBe(null);
        await admin.query("reset role");
        expect(
          (
            await admin.query(
              "select status from public.parent_assistant_messages where id=$1",
              [next],
            )
          ).rows[0].status,
        ).toBe("failed");
        await admin.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({ sub: other, session_id: session }),
        ]);
        await admin.query("set role authenticated");
        expect(
          (
            await admin.query(
              "select question from public.parent_assistant_messages",
            )
          ).rows,
        ).toHaveLength(0);
        await expect(
          admin.query(
            "select public.parent_ask_assistant($1,'Show private status',$2,true)",
            [request, randomUUID()],
          ),
        ).rejects.toThrow("request unavailable");
        await admin.query("reset role");
        expect(
          (
            await admin.query(
              "select count(*) total from public.parent_operations where request_id=$1",
              [request],
            )
          ).rows[0].total,
        ).toBe(0);
      } finally {
        await admin.query("reset role");
        await admin.end();
      }
    }, 20000);
    it("shares an atomic project model cap across accounts and preserves anonymous reservations after account deletion", async () => {
      const { admin } = await createParentSqlFixture(modulePath!);
      try {
        await admin.query(
          "update parent_private.processing_controls set model_budget_started_at=now()-interval '1 minute',model_call_limit=2",
        );
        await admin.query(
          "update parent_private.processing_controls set model_budget_started_at=now()+interval '1 minute'",
        );
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query(
          "update parent_private.processing_controls set model_budget_started_at=now()-interval '1 minute'",
        );
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(true);
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(true);
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query("delete from parent_private.ai_calls");
        await admin.query("delete from parent_private.assistant_calls");
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query(
          "update parent_private.processing_controls set model_budget_started_at=null,model_call_limit=null",
        );
        expect(
          (
            await admin.query(
              "select parent_private.reserve_model_capacity() value",
            )
          ).rows[0].value,
        ).toBe(true);
        await admin.query("set role parent_worker");
        await expect(
          admin.query("select parent_private.reserve_model_capacity()"),
        ).rejects.toThrow("permission denied");
      } finally {
        await admin.query("reset role");
        await admin.end();
      }
    }, 20000);
    it("excludes prior utility-account outcomes from model context while retaining independent food evidence", async () => {
      const { admin } = await createParentSqlFixture(modulePath!);
      const owner = randomUUID(),
        household = randomUUID(),
        request = randomUUID(),
        message = randomUUID();
      try {
        await admin.query(
          "update parent_private.processing_controls set enabled=true,approval_reference='synthetic-assistant-evidence',approved_until=now()+interval '1 day'",
        );
        await admin.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic-evidence@example.invalid',now())",
          [owner],
        );
        await admin.query("insert into public.parent_accounts(id) values($1)", [
          owner,
        ]);
        await admin.query(
          "insert into public.parent_households(id,owner_id) values($1,$2)",
          [household, owner],
        );
        await admin.query(
          "insert into public.parent_requests(id,household_id,intake,mandate,account_changed_at) values($1,$2,$3,$4,jsonb_build_object('electricity',now()-interval '1 day'))",
          [
            request,
            household,
            JSON.stringify(fixtureIntake()),
            JSON.stringify(fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() })),
          ],
        );
        for (const [need, program] of [
          ["electricity", "peco-cap"],
          ["food_now", "philly-food"],
        ]) {
          await admin.query(
            "insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence,created_at) values($1,1,$2,$3,'submit','{}',repeat('a',64),'{}',$4,'agency_submitted',jsonb_build_object('source','agency_receipt','reference','synthetic-no-real-application','recordedAt',now()-interval '2 days'),now()-interval '2 days')",
            [request, program, need, `synthetic-${need}`],
          );
          await admin.query(
            "insert into public.parent_events(request_id,kind,actor,summary,evidence,created_at) values($1,'parent.outcome_reported','parent','Synthetic report',jsonb_build_object('need',$2::text,'outcome','support_received','attribution','parent_reported'),now()-interval '2 days')",
            [request, need],
          );
        }
        await admin.query(
          "insert into public.parent_assistant_messages(id,request_id,request_version,idempotency_key,question) values($1,$2,1,$3,'What happened?')",
          [message, request, randomUUID()],
        );
        await admin.query("set role parent_worker");
        await admin.query(
          "select parent_private.parent_record_worker_health(false,true)",
        );
        const claimed = (
          await admin.query(
            "select parent_private.parent_claim_assistant() value",
          )
        ).rows[0].value as {
          operations: { need: string }[];
          reports: { need: string }[];
        };
        expect(claimed.operations.map((o) => o.need)).toEqual(["food_now"]);
        expect(claimed.reports.map((o) => o.need)).toEqual(["food_now"]);
      } finally {
        await admin.query("reset role");
        await admin.end();
      }
    }, 20000);
    it("checks the same project cap and combined account ceiling in both actual worker reservation functions", async () => {
      const { admin } = await createParentSqlFixture(modulePath!);
      const owner = randomUUID(),
        household = randomUUID(),
        request = randomUUID(),
        chatRequest = randomUUID(),
        message = randomUUID();
      try {
        await admin.query(
          "update parent_private.processing_controls set enabled=true,approval_reference='synthetic-assistant-budget',approved_until=now()+interval '1 day',model_budget_started_at=now()-interval '1 minute',model_call_limit=1",
        );
        await admin.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic-budget@example.invalid',now())",
          [owner],
        );
        await admin.query("insert into public.parent_accounts(id) values($1)", [
          owner,
        ]);
        await admin.query(
          "insert into public.parent_households(id,owner_id) values($1,$2)",
          [household, owner],
        );
        for (const id of [request, chatRequest])
          await admin.query(
            "insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)",
            [
              id,
              household,
              JSON.stringify(fixtureIntake()),
              JSON.stringify(fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() })),
            ],
          );
        await admin.query(
          "insert into public.parent_jobs(request_id,request_version) values($1,1)",
          [request],
        );
        await admin.query(
          "insert into public.parent_assistant_messages(id,request_id,request_version,idempotency_key,question) values($1,$2,1,$3,'What happens next?')",
          [message, chatRequest, randomUUID()],
        );
        await admin.query("set role parent_worker");
        await admin.query(
          "select parent_private.parent_record_worker_health(true,true)",
        );
        const chat = (
          await admin.query(
            "select parent_private.parent_claim_assistant() value",
          )
        ).rows[0].value as { leaseToken: string };
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_assistant_call($1,$2) value",
              [message, chat.leaseToken],
            )
          ).rows[0].value,
        ).toBe(true);
        const job = (
          await admin.query("select parent_private.parent_claim_job(120) value")
        ).rows[0].value as { jobId: string; leaseToken: string };
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_ai_call($1,$2) value",
              [job.jobId, job.leaseToken],
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query("reset role");
        await admin.query(
          "update parent_private.processing_controls set model_budget_started_at=null,model_call_limit=null",
        );
        await admin.query(
          "insert into parent_private.ai_calls(account_id,request_id) select $1,$2 from generate_series(1,58)",
          [owner, chatRequest],
        );
        await admin.query("set role parent_worker");
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_ai_call($1,$2) value",
              [job.jobId, job.leaseToken],
            )
          ).rows[0].value,
        ).toBe(true);
        expect(
          (
            await admin.query(
              "select parent_private.parent_reserve_ai_call($1,$2) value",
              [job.jobId, job.leaseToken],
            )
          ).rows[0].value,
        ).toBe(false);
        await admin.query("reset role");
        expect(
          (
            await admin.query(
              "select count(*) total from parent_private.model_call_reservations",
            )
          ).rows[0].total,
        ).toBe(2);
      } finally {
        await admin.query("reset role");
        await admin.end();
      }
    }, 20000);
  },
);

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)(
  "scoped parent corrections against PostgreSQL migrations",
  () => {
    it("preserves a corrected utility amount across ZIP edits and removes only superseded answers", async () => {
      const fixture = await createParentSqlFixture(modulePath!);
      const db = fixture.admin,
        owner = randomUUID(),
        session = randomUUID();
      try {
        await db.query(
          "update parent_private.processing_controls set enabled=true,approval_reference='synthetic correction test',approved_until=now()+interval '1 day'",
        );
        await db.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'correction@example.invalid',now())",
          [owner],
        );
        await db.query(
          "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
          [session, owner],
        );
        const parent = async (sql: string, values: unknown[] = []) => {
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
        };
        const intake = fixtureIntake({
          needs: ["electricity", "gas", "snap_new"],
          utilityProviders: ["peco", "pgw"],
        });
        const mandate = fixtureMandate({
          recipientIds: ["peco-cap", "pgw-crp", "uesf-benefits"],
          maxRecipients: 3,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
        const requestId = (
          await parent("select public.parent_start_request($1,$2,$3) id", [
            JSON.stringify(intake),
            JSON.stringify(mandate),
            randomUUID(),
          ])
        ).rows[0].id;
        const read = async () =>
          (
            await db.query("select * from public.parent_requests where id=$1", [
              requestId,
            ])
          ).rows[0];
        const answer = async (need: string, field: string, value: unknown) => {
          const current = await read();
          await parent("select public.parent_answer_fact($1,$2,$3,$4,$5)", [
            requestId,
            need,
            field,
            JSON.stringify(value),
            current.version,
          ]);
        };
        const correct = async (patch: Record<string, unknown>) => {
          const current = await read();
          await parent("select public.parent_correct_request($1,$2,$3)", [
            requestId,
            JSON.stringify({ ...current.intake, ...patch }),
            current.version,
          ]);
          return read();
        };
        await answer("electricity", "amountDue", 80);
        await answer("gas", "amountDue", 60);
        await answer("snap_new", "income", {
          amount: 700,
          frequency: "monthly",
        });
        await answer("electricity", "accountAuthority", "authorized_caregiver");
        await answer("electricity", "utilityProvider", "peco");
        await answer("gas", "utilityProvider", "pgw");
        await answer("electricity", "shutoffDate", "2026-11-10");
        await answer("electricity", "zip", "19104");
        await answer("snap_new", "householdSize", 4);
        await db.query(
          "insert into public.parent_documents(request_id,filename,media_type,size_bytes,object_path,consent_version,status,facts,upload_confirmed_at) values($1,'previous-bill.pdf','application/pdf',400,$2,'2026-10-25','validated',$3,now())",
          [
            requestId,
            `${owner}/${requestId}/${randomUUID()}`,
            JSON.stringify([
              {
                field: "amountDue",
                value: 100,
                sourceText: "Amount due $100.00",
                validatedAt: new Date().toISOString(),
              },
            ]),
          ],
        );
        const before = await read(),
          zip = await correct({ zip: "19103" });
        expect(zip.facts).toEqual(
          before.facts.filter(
            (fact: { field: string }) => fact.field !== "zip",
          ),
        );
        expect(zip.facts).toContainEqual(
          expect.objectContaining({
            need: "electricity",
            field: "amountDue",
            value: 80,
          }),
        );
        expect(
          (
            await db.query(
              "select facts->0->'value' amount from public.parent_documents where request_id=$1",
              [requestId],
            )
          ).rows[0].amount,
        ).toBe(100);
        const income = await correct({ incomeAmount: 800 });
        expect(
          income.facts.some((fact: { field: string }) =>
            ["income", "incomeAmount", "incomeFrequency"].includes(fact.field),
          ),
        ).toBe(false);
        expect(income.facts).toContainEqual(
          expect.objectContaining({ field: "amountDue", value: 80 }),
        );
        const providers = await correct({ utilityProviders: ["pgw"] });
        expect(
          providers.facts.filter(
            (fact: { field: string }) => fact.field === "utilityProvider",
          ),
        ).toEqual([expect.objectContaining({ need: "gas", value: "pgw" })]);
        expect(
          providers.facts.some(
            (fact: { need: string; field: string }) =>
              fact.need === "electricity" &&
              ["amountDue", "accountAuthority", "shutoffDate"].includes(
                fact.field,
              ),
          ),
        ).toBe(false);
        expect(providers.facts).toContainEqual(
          expect.objectContaining({
            need: "gas",
            field: "amountDue",
            value: 60,
          }),
        );
        expect(providers.account_changed_at.electricity).toBeTruthy();
        const authority = await correct({ accountAuthority: "not_sure" });
        expect(
          authority.facts.some(
            (fact: { field: string }) => fact.field === "accountAuthority",
          ),
        ).toBe(false);
        const removed = await correct({ needs: ["gas"] });
        expect(
          removed.facts.every((fact: { need: string }) => fact.need === "gas"),
        ).toBe(true);
        expect(removed.facts).toContainEqual(
          expect.objectContaining({ field: "amountDue", value: 60 }),
        );
        await answer("gas", "shutoffDate", "2026-11-20");
        expect(
          (await correct({ shutoffDate: "2026-11-21" })).facts.some(
            (fact: { field: string }) => fact.field === "shutoffDate",
          ),
        ).toBe(false);
        await correct({ accountAuthority: "self" });
        const oldVersion = (await read()).version;
        const oldOperation = randomUUID();
        await db.query(
          "insert into public.parent_operations(id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,state,evidence,executed_at) values($1,$2,$3,'gas','pgw-crp','share','{\"utilityProvider\":\"pgw\",\"amountDue\":60}',$4,array['utility'],array[]::uuid[],$5,'support_received','{\"source\":\"provider_api\",\"reference\":\"old-account-receipt\"}',now())",
          [oldOperation, requestId, oldVersion, "a".repeat(64), randomUUID()],
        );
        await parent(
          "select public.parent_report_outcome($1,'gas','support_received','Old gas account received support')",
          [requestId],
        );
        await answer("gas", "utilityProvider", "other");
        const switched = await read();
        expect(switched.intake.shutoffDate).toBeNull();
        expect(switched.intake.accountAuthority).toBe("self");
        expect(
          switched.facts.filter(
            (fact: { need: string }) => fact.need === "gas",
          ),
        ).toEqual([
          expect.objectContaining({ field: "utilityProvider", value: "other" }),
        ]);
        expect(switched.account_changed_at.gas).toBeTruthy();
        await db.query(
          "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until) values('pgw-crp','share',true,true,'synthetic','synthetic-provider-test',array['amountDue'],'{\"amountDue\":\"utility\"}',array[]::text[],now()+interval '1 day')",
        );
        await db.query("set role parent_worker");
        try {
          const job = (
            await db.query("select parent_private.parent_claim_job(120) job")
          ).rows[0].job;
          expect(job.request.account_changed_at.gas).toBeTruthy();
          await expect(
            db.query(
              "select parent_private.parent_prepare_operation($1,$2,$3,'pgw-crp','share','{\"amountDue\":10}',array['utility'],array[]::uuid[],$4,'gas')",
              [job.jobId, job.leaseToken, switched.version, randomUUID()],
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(
            db.query(
              "select parent_private.parent_close_job($1,$2,'completed','Old provider received support','parent','Return whenever needed')",
              [job.jobId, job.leaseToken],
            ),
          ).rejects.toMatchObject({ code: "23514" });
          await db.query(
            'select parent_private.parent_save_job_plan($1,$2,$3,\'{"version":1,"routes":[{"need":"gas","programId":"pgw-crp","state":"prepared"}]}\',\'[]\',null,\'operator\',\'provider_capability_enabled\')',
            [job.jobId, job.leaseToken, switched.version],
          );
        } finally {
          await db.query("reset role");
        }
        const held = await read();
        expect(held.status).toBe("active");
        expect(held.plan.routes[0].state).toBe("prepared");
        expect(
          (
            await db.query(
              "select state from public.parent_operations where id=$1",
              [oldOperation],
            )
          ).rows[0].state,
        ).toBe("support_received");
        await expect(
          parent("select public.parent_correct_request($1,$2,null)", [
            requestId,
            JSON.stringify((await read()).intake),
          ]),
        ).rejects.toMatchObject({ code: "40001" });
      } finally {
        await db.end();
      }
    }, 30000);
  },
);

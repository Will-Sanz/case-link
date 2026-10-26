import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { buildSupportPlan, requiredActions } from "./planning";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { DocumentProcessingError } from "./document-processing";
import {
  runOneParentJob,
  type RuntimeTransport,
  type WorkerRuntimeOptions,
} from "./worker-runtime";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)(
  "worker runtime against the parent PostgreSQL migrations",
  () => {
    it("persists exact dispatch, event, follow-up and unknown-delivery reconciliation through restricted RPCs", async () => {
      const fixture = await createParentSqlFixture(modulePath!);
      const admin = fixture.admin,
        ownerId = randomUUID(),
        householdId = randomUUID(),
        requestId = randomUUID();
      const now = () => new Date();
      const intake = fixtureIntake({ needs: ["electricity"] });
      const mandate = fixtureMandate({
        recipientIds: ["peco-cap"],
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      const sqlFailures: string[] = [];
      try {
        await admin.query(
          "update parent_private.processing_controls set enabled=true,approval_reference='synthetic-runtime-sql-test',approved_until=now()+interval '1 day'",
        );
        await admin.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic-runtime@example.invalid',now())",
          [ownerId],
        );
        await admin.query("insert into public.parent_accounts(id) values($1)", [
          ownerId,
        ]);
        await admin.query(
          "insert into public.parent_households(id,owner_id) values($1,$2)",
          [householdId, ownerId],
        );
        await admin.query(
          "insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)",
          [
            requestId,
            householdId,
            JSON.stringify(intake),
            JSON.stringify(mandate),
          ],
        );
        await admin.query(
          "insert into public.parent_jobs(request_id,request_version) values($1,1)",
          [requestId],
        );
        const goodDocument = randomUUID(),
          ambiguousDocument = randomUUID();
        for (const id of [goodDocument, ambiguousDocument]) {
          const path = `${householdId}/${requestId}/${id}`;
          await admin.query(
            "insert into public.parent_documents(id,request_id,filename,media_type,size_bytes,object_path,consent_version) values($1,$2,'synthetic.jpg','image/jpeg',1,$3,'2026-10-25')",
            [id, requestId, path],
          );
          await admin.query(
            'insert into storage.objects(bucket_id,name,metadata) values(\'parent-documents\',$1,\'{"size":1,"mimetype":"image/jpeg"}\')',
            [path],
          );
          // This fixture starts after a verified upload. The upload-confirmation RPC has separate authorization tests.
          await admin.query(
            "update public.parent_documents set upload_confirmed_at=now() where id=$1",
            [id],
          );
        }
        await admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
        select 'peco-cap',action,true,true,false,'synthetic-v1','synthetic-no-real-provider',array['zip','householdSize','utilityProvider','accountAuthority','statusReference','amountDue','documentIds'],'{"zip":"household","householdSize":"household","utilityProvider":"utility","accountAuthority":"utility","statusReference":"household","amountDue":"utility","documentIds":"documents"}'::jsonb,'{}',now()+interval '1 day' from unnest(array['submit','follow_up']) action`);
        const execute = vi.fn<RuntimeTransport["execute"]>(async () => ({
          state: "sent",
          source: "provider_api",
          reference: "synthetic-status-reference",
          recordedAt: now().toISOString(),
        }));
        const reconcile = vi.fn<NonNullable<RuntimeTransport["reconcile"]>>(
          async () => ({
            state: "partner_received",
            source: "provider_api",
            reference: "synthetic-status-reference",
            recordedAt: now().toISOString(),
          }),
        );
        const options: WorkerRuntimeOptions = {
          database: {
            async query(sql, values) {
              await admin.query("set role parent_worker");
              try {
                return await admin.query(sql, values);
              } catch (error) {
                sqlFailures.push(
                  `${sql}: ${error instanceof Error ? error.message : "SQL failure"}`,
                );
                throw error;
              } finally {
                await admin.query("reset role");
              }
            },
          },
          apiKey: "synthetic-not-a-real-key",
          brokerOrigin: "http://127.0.0.1:3310",
          brokerSecret: "synthetic-not-a-real-broker-secret-32",
          supabaseOrigin: "http://127.0.0.1:55321",
          now,
          fetcher: vi.fn(async (input, init) => {
            if (String(input) === "http://127.0.0.1:3310/objects") {
              const purpose = JSON.parse(String(init?.body));
              return Response.json({
                signedUrl: `http://127.0.0.1:55321/storage/v1/object/sign/${purpose.bucket}/${purpose.objectPath}?token=synthetic`,
              });
            }
            if (
              String(input).startsWith(
                "http://127.0.0.1:55321/storage/v1/object/sign/parent-documents/",
              )
            )
              return new Response(
                new Uint8Array([
                  String(input).includes(ambiguousDocument) ? 2 : 1,
                ]),
              );
            throw new Error(
              "No network belongs in this synthetic SQL contract test",
            );
          }) as typeof fetch,
          processDocument: async (input) => {
            await input.beforeProcessing();
            if (input.bytes[0] === 2)
              throw new DocumentProcessingError("ambiguous");
            await input.beforeCall();
            const sourceObservedAt = now().toISOString().slice(0, 10);
            return {
              facts: {
                provider: "peco",
                amountDue: 50,
                totalBalance: null,
                dueDate: null,
                shutoffDate: null,
                fields: [
                  { field: "provider", page: 1, sourceText: "PECO" },
                  {
                    field: "amountDue",
                    page: 1,
                    sourceText: "Amount due $50.00",
                  },
                ],
              },
              sourcePages: [
                `PECO\nAmount due $50.00\nStatement date ${sourceObservedAt}`,
              ],
              sourceObservedAt,
              pageCount: 1,
              inputTokens: 0,
              outputTokens: 0,
            };
          },
          transports: new Map([
            ["peco-cap:submit", { execute }],
            ["peco-cap:follow_up", { execute, reconcile }],
          ]),
          coordinate: async (input) => {
            await input.beforeCall?.();
            return {
              plan: buildSupportPlan(input.intake, input.mandate, input.now),
              requiredActions: requiredActions(input.intake, input.mandate),
              modelCalls: 1,
              inputTokens: 0,
              outputTokens: 0,
            };
          },
        };
        expect(
          await runOneParentJob(options),
          JSON.stringify(sqlFailures),
        ).toEqual({ state: "saved" });
        expect(execute).toHaveBeenCalledTimes(1);
        const documentStates = (
          await admin.query(
            "select id,status,facts_valid_until from public.parent_documents where request_id=$1",
            [requestId],
          )
        ).rows;
        expect(
          documentStates.find((document) => document.id === goodDocument)
            ?.status,
        ).toBe("validated");
        expect(
          documentStates.find((document) => document.id === goodDocument)
            ?.facts_valid_until,
        ).toBeTruthy();
        expect(
          documentStates.find((document) => document.id === ambiguousDocument)
            ?.status,
        ).toBe("unreadable");
        expect(
          (
            await admin.query(
              "select state,need from public.parent_operations where request_id=$1",
              [requestId],
            )
          ).rows,
        ).toEqual([{ state: "sent", need: "electricity" }]);
        expect(
          Number(
            (
              await admin.query(
                "select count(*) count from public.parent_events where request_id=$1 and source_key is not null",
                [requestId],
              )
            ).rows[0].count,
          ),
        ).toBe(1);

        // A missing receipt never causes an application to be submitted again.
        await admin.query(
          "update public.parent_operations set state='delivery_unknown' where request_id=$1",
          [requestId],
        );
        await admin.query(
          "update public.parent_jobs set state='queued',run_at=now() where request_id=$1",
          [requestId],
        );
        expect(await runOneParentJob(options)).toEqual({ state: "saved" });
        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(
          (
            await admin.query(
              "select state from public.parent_operations where request_id=$1",
              [requestId],
            )
          ).rows[0].state,
        ).toBe("partner_received");

        // Two later checks may reuse the same agency reference; each has its own logical cycle.
        for (let cycle = 0; cycle < 2; cycle++) {
          await admin.query(
            "update public.parent_operations set updated_at=now()-interval '2 days' where request_id=$1",
            [requestId],
          );
          await admin.query(
            "update public.parent_jobs set state='queued',run_at=now() where request_id=$1",
            [requestId],
          );
          execute.mockResolvedValue({
            state: cycle === 0 ? "partner_accepted" : "support_received",
            source: "provider_api",
            reference: "synthetic-status-reference",
            recordedAt: now().toISOString(),
          });
          expect(await runOneParentJob(options)).toEqual({ state: "saved" });
        }
        expect(execute).toHaveBeenCalledTimes(3);
        const final = (
          await admin.query(
            "select status,plan,next_actor,next_trigger from public.parent_requests where id=$1",
            [requestId],
          )
        ).rows[0];
        expect(final.plan.routes[0].state).toBe("support_received");
        expect(final.status).toBe("closed");
        expect(final.next_trigger).toBe("parent_reentry");
        expect(
          Number(
            (
              await admin.query(
                "select count(*) count from public.parent_operations where request_id=$1 and action='follow_up'",
                [requestId],
              )
            ).rows[0].count,
          ),
        ).toBe(2);
      } finally {
        await admin.end();
      }
    }, 30000);
  },
);

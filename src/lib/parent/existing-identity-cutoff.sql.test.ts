import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)(
  "existing-identity enrollment cutoff against PostgreSQL migrations",
  () => {
    it("limits interactive and durable parent work without replacing existing account and session controls", async () => {
      const fixture = await createParentSqlFixture(modulePath!);
      const db = fixture.admin;
      const cutoff = new Date("2026-10-26T12:00:00Z");
      const identities = [
        {
          name: "older-parent",
          createdAt: new Date(cutoff.getTime() - 1000),
          staff: false,
        },
        { name: "boundary-parent", createdAt: cutoff, staff: false },
        {
          name: "newer-parent",
          createdAt: new Date(cutoff.getTime() + 1000),
          staff: false,
        },
        {
          name: "older-staff",
          createdAt: new Date(cutoff.getTime() - 1000),
          staff: true,
        },
        {
          name: "newer-staff",
          createdAt: new Date(cutoff.getTime() + 1000),
          staff: true,
        },
        {
          name: "banned-parent",
          createdAt: new Date(cutoff.getTime() - 1000),
          staff: false,
        },
        {
          name: "unverified-parent",
          createdAt: new Date(cutoff.getTime() - 1000),
          staff: false,
        },
        { name: "missing-date-parent", createdAt: null, staff: false },
      ].map((identity) => ({
        ...identity,
        id: randomUUID(),
        session: randomUUID(),
        request: "",
      }));
      const [
        older,
        boundary,
        newer,
        staff,
        newerStaff,
        banned,
        unverified,
        missingDate,
      ] = identities;
      async function parent(
        identity: typeof older,
        sql: string,
        values: unknown[] = [],
        method = identity.staff ? "password" : "otp",
      ) {
        await db.query("set role authenticated");
        try {
          await db.query("select set_config('request.jwt.claims',$1,false)", [
            JSON.stringify({
              sub: identity.id,
              session_id: identity.session,
              role: "authenticated",
              amr: [{ method }],
            }),
          ]);
          return await db.query(sql, values);
        } finally {
          await db.query("reset role");
        }
      }
      const denied = (identity: typeof older, method?: string) =>
        expect(
          parent(identity, "select public.parent_ensure_account()", [], method),
        ).rejects.toMatchObject({ code: "42501" });
      async function grant(identity: typeof older) {
        return (
          await db.query(
            "select parent_private.current_grant($1,1) granted,parent_private.notification_allowed($1,1) notification",
            [identity.request],
          )
        ).rows[0];
      }
      try {
        expect(
          (
            await db.query(
              "select existing_identity_created_before from parent_private.processing_controls",
            )
          ).rows[0].existing_identity_created_before,
        ).toBeNull();
        expect((await db.query("select pilot_account_ids from parent_private.processing_controls")).rows[0].pilot_account_ids).toBeNull();
        await db.query(
          "update parent_private.processing_controls set enabled=true,existing_accounts_enabled=true,approval_reference='synthetic existing-identity cutoff',approved_until=now()+interval '1 day'",
        );
        for (const identity of identities) {
          await db.query(
            "insert into auth.users(id,email,email_confirmed_at,created_at,banned_until) values($1,$2,case when $3 then null else now() end,$4,case when $5 then now()+interval '1 day' else null end)",
            [
              identity.id,
              `${identity.name}@example.invalid`,
              identity === unverified,
              identity.createdAt,
              identity === banned,
            ],
          );
          await db.query(
            "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
            [identity.session, identity.id],
          );
          if (identity.staff)
            await db.query(
              "insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)",
              [identity.id, `${identity.name}@example.invalid`],
            );
        }
        for (const identity of [
          older,
          boundary,
          newer,
          staff,
          newerStaff,
          missingDate,
        ]) {
          expect(
            (
              await parent(
                identity,
                "select public.parent_ensure_account() household",
              )
            ).rows[0].household,
          ).toBeTruthy();
          await db.query(
            "update public.parent_accounts set preferences=jsonb_set(preferences,'{contactPreference}','\"email\"') where id=$1",
            [identity.id],
          );
          identity.request = String(
            (
              await parent(
                identity,
                "select public.parent_start_request($1,$2,$3) id",
                [
                  JSON.stringify(
                    fixtureIntake({
                      needs: ["food_now"],
                      contactPreference: "email",
                    }),
                  ),
                  JSON.stringify(
                    fixtureMandate({
                      recipientIds: ["philly-food"],
                      expiresAt: new Date(Date.now() + 86400000).toISOString(),
                    }),
                  ),
                  randomUUID(),
                ],
              )
            ).rows[0].id,
          );
          expect(await grant(identity)).toEqual({
            granted: true,
            notification: true,
          });
        }
        await db.query(
          "update parent_private.processing_controls set existing_identity_created_before=$1",
          [cutoff],
        );
        for (const identity of [older, boundary, staff]) {
          expect(
            (
              await parent(
                identity,
                "select public.parent_ensure_account() household",
              )
            ).rows[0].household,
          ).toBeTruthy();
          expect(await grant(identity)).toEqual({
            granted: true,
            notification: true,
          });
        }
        for (const identity of [newer, newerStaff, missingDate]) {
          await denied(identity);
          expect(await grant(identity)).toEqual({
            granted: false,
            notification: false,
          });
          expect(
            (await parent(identity, "select id from public.parent_accounts"))
              .rows,
          ).toEqual([]);
        }
        await db.query(
          "update parent_private.processing_controls set pilot_account_ids=$1::uuid[]",
          [[older.id, staff.id, newer.id, banned.id, unverified.id]],
        );
        for (const identity of [older, staff]) {
          expect((await parent(identity, "select public.parent_ensure_account() household")).rows[0].household).toBeTruthy();
          expect(await grant(identity)).toEqual({ granted: true, notification: true });
        }
        for (const identity of [boundary, newer, newerStaff, missingDate, banned, unverified]) {
          await denied(identity);
          if (identity.request) {
            expect(await grant(identity)).toEqual({ granted: false, notification: false });
            expect((await parent(identity, "select id from public.parent_accounts")).rows).toEqual([]);
          }
        }
        await expect(parent(older, "update parent_private.processing_controls set pilot_account_ids=null"))
          .rejects.toMatchObject({ code: "42501" });
        expect((await db.query("select parent_private.assistant_owner_available($1,1) allowed", [boundary.request])).rows[0].allowed).toBe(false);
        await db.query("update parent_private.processing_controls set pilot_account_ids='{}'::uuid[]");
        for (const identity of [older, staff]) {
          await denied(identity);
          expect(await grant(identity)).toEqual({ granted: false, notification: false });
        }
        expect((await db.query("select existing_identity_created_before from parent_private.processing_controls")).rows[0].existing_identity_created_before)
          .toEqual(cutoff);
        await db.query("update parent_private.processing_controls set pilot_account_ids=null");
        expect((await parent(boundary, "select public.parent_ensure_account() household")).rows[0].household).toBeTruthy();
        expect(await grant(boundary)).toEqual({ granted: true, notification: true });
        await denied(staff, "otp");
        await denied(banned);
        await denied(unverified);
        await expect(
          parent(
            older,
            "update parent_private.processing_controls set existing_identity_created_before=null",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await db.query(
          "update public.app_users set is_active=false where id=$1",
          [staff.id],
        );
        await denied(staff);
        expect(await grant(staff)).toEqual({
          granted: false,
          notification: false,
        });
        expect(await grant(older)).toEqual({
          granted: true,
          notification: true,
        });
        await db.query("delete from auth.sessions where id=$1", [
          older.session,
        ]);
        await denied(older);
        await db.query(
          "update parent_private.processing_controls set existing_identity_created_before=null",
        );
        for (const identity of [newer, newerStaff, missingDate]) {
          expect(
            (
              await parent(
                identity,
                "select public.parent_ensure_account() household",
              )
            ).rows[0].household,
          ).toBeTruthy();
          expect(await grant(identity)).toEqual({
            granted: true,
            notification: true,
          });
        }
        await denied(staff);
        await denied(banned);
        await denied(unverified);
        expect(
          (await db.query("select count(*)::integer count from auth.users"))
            .rows[0].count,
        ).toBe(8);
        expect(
          (
            await db.query(
              "select count(*)::integer count from public.app_users",
            )
          ).rows[0].count,
        ).toBe(2);
        expect(
          (
            await db.query(
              "select is_active from public.app_users where id=$1",
              [staff.id],
            )
          ).rows[0].is_active,
        ).toBe(false);
      } finally {
        await db.end();
      }
    }, 30000);
  },
);

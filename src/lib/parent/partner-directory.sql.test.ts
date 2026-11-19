import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("parent-safe existing partner directory", () => {
  it("links real directory rows without granting school-directory access or leaking contacts", async () => {
    const fixture = await createParentSqlFixture(modulePath!);
    const db = fixture.admin;
    const parentId = randomUUID();
    const parentSession = randomUUID();
    const schoolId = randomUUID();
    const schoolSession = randomUUID();
    const legacyIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    async function authenticated(
      id: string,
      session: string,
      sql: string,
      method = "otp",
    ) {
      await db.query("set role authenticated");
      try {
        await db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: id,
            session_id: session,
            role: "authenticated",
            amr: [{ method }],
          }),
        ]);
        return await db.query(sql);
      } finally {
        await db.query("reset role");
      }
    }
    const directory = () =>
      authenticated(
        parentId,
        parentSession,
        "select public.parent_partner_directory() partners",
      );
    try {
      await db.query(
        "update parent_private.processing_controls set enabled=true,approval_reference='synthetic directory test',approved_until=now()+interval '1 day'",
      );
      for (const [id, session] of [
        [parentId, parentSession],
        [schoolId, schoolSession],
      ]) {
        await db.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
          [id, `${id}@example.invalid`],
        );
        await db.query(
          "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
          [session, id],
        );
      }
      await db.query(
        "insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)",
        [schoolId, `${schoolId}@example.invalid`],
      );
      await authenticated(
        parentId,
        parentSession,
        "select public.parent_ensure_account()",
      );
      const slugs = [
        "uesf-utility-emergency-service-funding-9b971619",
        "peco-utility-information-on-electric-service-1c757482",
        "philadelphia-water-department-pwd-customer-assistance-program-cap-ff6c8f8b",
        "the-philadelphia-water-department-water-assistance-programs-4be363a6",
        "unverified-unrelated-resource",
      ];
      for (const [index, slug] of slugs.entries())
        await db.query(
          "insert into public.resources(id,slug,primary_contact_name,primary_contact_email,primary_contact_phone,description) values($1,$2,'PRIVATE-CONTACT-CANARY','canary@example.invalid','PRIVATE-PHONE','PRIVATE-DESCRIPTION')",
          [legacyIds[index] ?? randomUUID(), slug],
        );
      const partners = (await directory()).rows[0].partners as {
        legacyResourceId: string;
        name: string;
        officialUrl: string;
        execution: string;
      }[];
      expect(partners).toHaveLength(4);
      expect(partners.map((p) => p.legacyResourceId).sort()).toEqual(
        legacyIds.sort(),
      );
      expect(partners.every((p) => p.execution === "not_connected")).toBe(true);
      expect(JSON.stringify(partners)).not.toMatch(/PRIVATE|canary|contact_/);
      expect(partners.find((p) => p.name === "UESF")?.officialUrl).toBe(
        "https://uesfacts.org/check-your-eligibility/",
      );
      await expect(
        authenticated(
          parentId,
          parentSession,
          "select * from public.resources",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        authenticated(
          schoolId,
          schoolSession,
          "select public.parent_partner_directory()",
          "password",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("set role anon");
      await expect(
        db.query("select public.parent_partner_directory()"),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("reset role");
      await db.query("update public.resources set active=false where slug=$1", [
        slugs[0],
      ]);
      await db.query("update public.resources set is_demo=true where slug=$1", [
        slugs[1],
      ]);
      expect((await directory()).rows[0].partners).toHaveLength(2);
      await db.query(
        "update parent_private.processing_controls set enabled=false",
      );
      await expect(directory()).rejects.toMatchObject({ code: "42501" });
      await db.query(
        "update parent_private.processing_controls set enabled=true",
      );
      await db.query("delete from auth.sessions where id=$1", [parentSession]);
      await expect(directory()).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("reset role");
      await db.end();
    }
  }, 30000);
});

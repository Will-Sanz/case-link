import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;

describe.skipIf(!modulePath)("assistant context purpose against PostgreSQL migrations", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(),
    otherOwner = randomUUID();
  const sessions = new Map([owner, otherOwner].map((id) => [id, randomUUID()]));
  type Claim = {
    messageId: string;
    leaseToken: string;
    request: { id: string; version: number; status: string };
    history: {
      request_version: number;
      question: string;
      answer: { paragraphs: { text: string }[] };
    }[];
  };

  async function query(
    role: "authenticated" | "parent_worker",
    sql: string,
    values: unknown[] = [],
    user = owner,
  ) {
    const db = fixture.admin;
    await db.query(`set role ${role}`);
    try {
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(role === "authenticated"
          ? { sub: user, session_id: sessions.get(user), role, amr: [{ method: "otp" }] }
          : { role }),
      ]);
      return await db.query(sql, values);
    } finally {
      await db.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic assistant-purpose test',approved_until=now()+interval '1 day'",
    );
    for (const user of [owner, otherOwner]) {
      await fixture.admin.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [user, `${user}@example.invalid`],
      );
      await fixture.admin.query(
        "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
        [sessions.get(user), user],
      );
    }
    await query("parent_worker", "select parent_private.parent_record_worker_health(false,true)");
  });

  afterAll(async () => {
    await fixture?.admin.end();
  });

  async function start(user = owner) {
    const intake = fixtureIntake({ incomeAmount: 3125, incomeFrequency: "monthly" });
    const mandate = fixtureMandate({ expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const result = await query(
      "authenticated",
      "select public.parent_start_request($1,$2,$3) id",
      [JSON.stringify(intake), JSON.stringify(mandate), randomUUID()],
      user,
    );
    return { id: result.rows[0].id as string, intake, mandate };
  }

  async function ask(requestId: string, question = "What is happening with my request?", user = owner) {
    const result = await query(
      "authenticated",
      "select public.parent_ask_assistant($1,$2,$3,true) id",
      [requestId, question, randomUUID()],
      user,
    );
    return result.rows[0].id as string;
  }

  async function claim(): Promise<Claim | null> {
    return (await query(
      "parent_worker",
      "select parent_private.parent_claim_assistant() claim",
    )).rows[0].claim;
  }

  async function finish(work: Claim, text: string) {
    await query(
      "parent_worker",
      "select parent_private.parent_finish_assistant($1,$2,$3)",
      [work.messageId, work.leaseToken, JSON.stringify({
        intro: "Your saved information",
        paragraphs: [{ text, sourceLabel: "Your saved request" }],
        actionIds: [],
      })],
    );
  }

  async function savedAnswer(requestId: string, text: string) {
    const message = await ask(requestId);
    const work = (await claim())!;
    expect(work.messageId).toBe(message);
    await finish(work, text);
    return message;
  }

  it("keeps same-version history available for a continuing question", async () => {
    const request = await start();
    await savedAnswer(request.id, "Current request context remains available.");
    const message = await ask(request.id, "What should I do next?");
    const work = (await claim())!;
    expect(work.messageId).toBe(message);
    expect(work.history).toHaveLength(1);
    expect(work.history[0].request_version).toBe(work.request.version);
    expect(JSON.stringify(work.history)).toContain("Current request context remains available.");
    await finish(work, "The saved status is unchanged.");
  });
  it("passes actual source dates and exact-need restrictions through the assistant snapshot", async () => {
    const request = await start();
    await query("authenticated", "select public.parent_answer_fact($1,'electricity','income',$2,1)", [
      request.id, JSON.stringify({ amount: 2200, frequency: "monthly" }),
    ]);
    await ask(request.id);
    const work = (await claim())!;
    const owned = await query("authenticated",
      "select intake_confirmed_at,intake_need_scoped_fields from public.parent_requests where id=$1", [request.id]);
    expect(owned.rows[0].intake_need_scoped_fields).toEqual(["incomeAmount"]);
    expect(work.request).toMatchObject(owned.rows[0]);
    await finish(work, "Current source information is available.");
  });

  it("excludes prior income context after real permission narrowing without erasing owner-visible history", async () => {
    const request = await start();
    const original = await savedAnswer(request.id, "Your saved income is $3125 monthly.");
    await query("authenticated", "select public.parent_replace_mandate($1,$2,1)", [
      request.id, JSON.stringify({ ...request.mandate, allowedData: ["household"] }),
    ]);
    const message = await ask(request.id);
    const work = (await claim())!;
    expect(work.messageId).toBe(message);
    expect(work.request.version).toBe(2);
    expect(work.history).toEqual([]);
    const visible = await query(
      "authenticated",
      "select answer from public.parent_assistant_messages where id=$1",
      [original],
    );
    expect(JSON.stringify(visible.rows[0].answer)).toContain("3125");
    await finish(work, "Only current authorized context is used.");
  });

  it("excludes superseded location context after a real intake correction", async () => {
    const request = await start();
    const original = await savedAnswer(request.id, "Your previous ZIP is 19104.");
    await query("authenticated", "select public.parent_correct_request($1,$2,1)", [
      request.id, JSON.stringify({ ...request.intake, zip: "19103" }),
    ]);
    const message = await ask(request.id);
    const work = (await claim())!;
    expect(work.messageId).toBe(message);
    expect(work.request.version).toBe(2);
    expect(work.history).toEqual([]);
    expect((await query(
      "authenticated",
      "select id from public.parent_assistant_messages where id=$1",
      [original],
    )).rows).toHaveLength(1);
    await finish(work, "Current ZIP is available from the corrected request.");
  });

  it("does not grant another active household access to questions or saved answers", async () => {
    const request = await start();
    const original = await savedAnswer(request.id, "Only this household can read this answer.");
    await start(otherOwner);
    await expect(ask(request.id, "What is the saved status?", otherOwner))
      .rejects.toMatchObject({ code: "42501" });
    expect((await query(
      "authenticated",
      "select id,answer from public.parent_assistant_messages where id=$1",
      [original],
      otherOwner,
    )).rows).toEqual([]);
  });

  it("denies cancelled or revoked queued work while allowing a fresh saved-status question after request cancellation", async () => {
    const request = await start();
    const cancelledQuestion = await ask(request.id);
    await query("authenticated", "select public.parent_cancel_assistant($1,$2)", [request.id, cancelledQuestion]);
    expect(await claim()).toBeNull();
    await ask(request.id);
    await query("authenticated", "select public.parent_control_request($1,'cancel')", [request.id]);
    expect(await claim()).toBeNull();

    const freshQuestion = await ask(request.id, "What is the status of my cancelled request?");
    const work = (await claim())!;
    expect(work.messageId).toBe(freshQuestion);
    expect(work.request.status).toBe("cancelled");
    await finish(work, "Future service work is stopped.");

    await ask(request.id);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    expect(await claim()).toBeNull();
  });
});

import assert from "node:assert/strict";

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

export function assertSyntheticParentAuthTargets(origin: string, local: Record<string, string>) {
  assert.equal(origin, "http://127.0.0.1:3200", "Synthetic Auth approval requires the exact isolated parent app.");
  assert.equal(local.API_URL, "http://127.0.0.1:55321", "Synthetic Auth approval requires the exact isolated parent API.");
  assert.equal(local.MAILPIT_URL, "http://127.0.0.1:55324", "Synthetic Auth approval requires the exact isolated test inbox.");
  const database = new URL(local.DB_URL);
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && database.hostname === "127.0.0.1" && database.port === "55322" && database.pathname === "/postgres" && !database.search && !database.hash,
    "Synthetic Auth approval requires the exact isolated parent database.");
}

/** One existing local-fixture approval, bounded to 20 minutes; every original control is restored. */
export async function beginParentTestApproval(db: Database, emptyClosedStack = false) {
  const locked = (await db.query("select pg_try_advisory_lock(627281933) as acquired")).rows[0]?.acquired;
  assert.equal(locked, true, "Another browser test owns the isolated fixture controls.");
  let original: Record<string, unknown> | undefined;
  let changed = false;
  const restore = async () => {
    try {
      if (changed && original) {
        const column = (name: string) => `"${name.replaceAll('"', '""')}"`;
        const columns = Object.keys(original).filter(key => key !== "singleton").map(column).join(",");
        await db.query(`update parent_private.processing_controls c set (${columns})=(select ${columns} from jsonb_populate_record(null::parent_private.processing_controls,$1::jsonb) restored) where singleton`, [JSON.stringify(original)]);
        assert.deepEqual((await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0]?.value, original,
          "The isolated fixture must restore the complete original processing controls.");
        changed = false;
      }
    } finally { await db.query("select pg_advisory_unlock(627281933)"); }
  };
  try {
    original = (await db.query("select to_jsonb(c) value from parent_private.processing_controls c where singleton")).rows[0]?.value as Record<string, unknown> | undefined;
    assert.ok(original, "The isolated processing control exists.");
    assert.equal(original.existing_identity_created_before, null, "A configured identity cutoff must not be broadened for tests.");
    if (emptyClosedStack) {
      assert.equal(original.enabled, false, "CI fixture approval requires closed processing.");
      assert.equal(original.pilot_account_ids, null, "CI fixture approval must not replace an existing cohort.");
      assert.ok(!Object.entries(original).some(([key, value]) => key.endsWith("_enabled") && value === true), "CI fixture approval requires closed purpose controls.");
      const occupied = (await db.query(`select exists(select 1 from auth.users) or exists(select 1 from public.parent_accounts)
        or exists(select 1 from public.parent_requests) or exists(select 1 from public.parent_jobs)
        or exists(select 1 from parent_private.provider_capabilities where enabled)
        or exists(select 1 from parent_private.worker_health where expires_at>clock_timestamp()) occupied`)).rows[0]?.occupied;
      assert.equal(occupied, false, "CI fixture approval requires an empty stack with no active provider or worker.");
    }
    changed = true;
    const row = (await db.query(`update parent_private.processing_controls set enabled=true,
      approval_reference='owner-authorized isolated synthetic browser connection test',approved_until=clock_timestamp()+interval '20 minutes'
      where singleton returning approved_until::text approved_until`)).rows[0];
    assert.ok(row && Number.isFinite(Date.parse(String(row.approved_until))), "The bounded local fixture approval was recorded.");
    return { approvedUntil: new Date(String(row.approved_until)).toISOString(), restore };
  } catch (error) { await restore(); throw error; }
}

import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), storage: vi.fn(), query: vi.fn(), end: vi.fn(), connect: vi.fn(), destroy: vi.fn(), s3: vi.fn(), remove: vi.fn(), s3Destroy: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.client(options);
    }
    connection = { stream: { destroy: () => mocks.destroy() } };
    on() { return this; }
    connect() { return mocks.connect() ?? Promise.resolve(); }
    async query(sql: string, values?: unknown[]) { return mocks.query(sql, values); }
    end() { return mocks.end() ?? Promise.resolve(); }
  },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.storage }));
vi.mock("../src/lib/parent/storage-s3", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/parent/storage-s3")>(), createS3Storage: mocks.s3,
}));
const originalExit = process.exitCode;
afterEach(() => {
  process.exitCode = originalExit;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it.each([
  "db.other.supabase.co:5432/postgres?sslmode=verify-full",
  "db.approved.supabase.co:5432/postgres?sslmode=verify-full&sslmode=no-verify",
])(
  "rejects an unsafe standalone connected retention target before creating privileged clients: %s",
  async (target) => {
    vi.resetModules();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const [key, value] of Object.entries({
      CASELINK_PRODUCT: "parent",
      CASELINK_ENVIRONMENT: "connected",
      CASELINK_PARENT_ACCOUNT_MODE: "existing",
      CASELINK_PARENT_CONNECTED_APPROVED: "1",
      CASELINK_PARENT_RETENTION_APPROVED: "1",
      CASELINK_PARENT_RETENTION_DATABASE_URL: `postgresql://restricted:synthetic@${target}`,
      CASELINK_PARENT_RETENTION_SUPABASE_URL: "https://approved.supabase.co",
      CASELINK_PARENT_RETENTION_STORAGE_KEY: "synthetic-storage-key",
      CASELINK_SCHOOL_SUPABASE_URL: "https://approved.supabase.co",
      CASELINK_PARENT_PRODUCTION_SUPABASE_URL: "https://approved.supabase.co",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
      VERCEL: "",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    await import("./parent-support-retention");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  },
);

const principal = () => ({ rolname: "synthetic_retention", rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false,
  rolcreaterole: false, rolcreatedb: false, rolreplication: false, member: true, can_set: true, admin_option: false,
  broader_membership: false, group_membership: false, group_login: false, group_inherit: false, group_super: false,
  group_bypassrls: false, group_createrole: false, group_createdb: false, group_replication: false });
type Options = { env?: Record<string, string | undefined>; principal?: Record<string, unknown> | null; wait?: boolean;
  hangAt?: "connect" | "purge" | "end"; errorAt?: "connect" | "purge"; batch?: unknown; purgeReply?: Promise<unknown> };
async function localRetention(counts: unknown[], options: Options = {}) {
  vi.resetModules();
  const stdout=vi.spyOn(process.stdout,"write").mockImplementation(()=>true),stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  for(const [key,value]of Object.entries({
    CASELINK_PRODUCT:"parent",CASELINK_ENVIRONMENT:"test",CASELINK_PARENT_ACCOUNT_MODE:"isolated",
    CASELINK_PARENT_RETENTION_DATABASE_URL:"postgresql://synthetic_retention:synthetic@127.0.0.1:55322/postgres",
    CASELINK_PARENT_RETENTION_SUPABASE_URL:"http://127.0.0.1:55321",CASELINK_PARENT_RETENTION_STORAGE_KEY:"SYNTHETIC_STORAGE_CANARY",
    CASELINK_SCHOOL_SUPABASE_URL:"https://school.synthetic.supabase.co",CASELINK_PARENT_PRODUCTION_SUPABASE_URL:"https://production.synthetic.supabase.co",
    CASELINK_PARENT_RETENTION_MODE:"all",CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED:undefined,
    CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:undefined,CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE:undefined,
    ...options.env,
  }))vi.stubEnv(key,value);
  let next=0;
  mocks.storage.mockReturnValue({});
  mocks.s3.mockReturnValue({ remove: mocks.remove, destroy: mocks.s3Destroy });
  if(options.hangAt==="connect")mocks.connect.mockImplementation(()=>new Promise(()=>{}));
  if(options.hangAt==="end")mocks.end.mockImplementation(()=>new Promise(()=>{}));
  if(options.errorAt==="connect")mocks.connect.mockRejectedValue(new Error("PRIVATE_CONNECTION_CANARY"));
  let claimed=false;
  mocks.query.mockImplementation((sql:string)=>{
    if(sql.includes("from pg_roles"))return{rows:options.principal===null?[]:[options.principal??principal()]};
    if(sql==="set role parent_retention_worker")return{rows:[]};
    if(sql==="select current_user as name")return{rows:[{name:"parent_retention_worker"}]};
    if(sql.includes("parent_purge_snap_final_packets")){
      if(options.hangAt==="purge")return new Promise(()=>{});
      if(options.errorAt==="purge")throw new Error("PRIVATE_QUERY_CANARY");
      if(options.purgeReply)return options.purgeReply;
      return{rows:[{removed:counts[next++]??0}]};
    }
    if(sql.includes("parent_claim_cleanup")){const batch=claimed?null:options.batch??null;claimed=true;return{rows:[{batch}]};}
    if(sql.includes("parent_finish_cleanup"))return{rows:[]};
    throw new Error("Unexpected synthetic retention query");
  });
  await import("./parent-support-retention");if(options.wait!==false)await vi.waitFor(()=>expect(mocks.end.mock.calls.length===1||process.exitCode===1).toBe(true));
  return{stdout:stdout.mock.calls.map(call=>String(call[0])).join(""),stderr:stderr.mock.calls.map(call=>String(call[0])).join(""),queries:mocks.query.mock.calls.map(call=>String(call[0]))};
}

const packetRetention = (counts: unknown[], options: Options = {}) => localRetention(counts, { ...options, env: {
  CASELINK_PARENT_RETENTION_MODE: "snap-packets", CASELINK_PARENT_RETENTION_STORAGE_KEY: undefined,
  CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED: "1", CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: new Date(Date.now()+3600000).toISOString(),
  CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE: "Synthetic offline maintenance approval only", ...options.env,
} });

it("purges protected packets first and reports only aggregate counts",async()=>{
  const result=await localRetention([100,100,3]);
  expect(result.queries.filter(sql=>sql.includes("parent_purge_snap_final_packets"))).toHaveLength(3);
  expect(result.queries.findLastIndex(sql=>sql.includes("parent_purge_snap_final_packets"))).toBeLessThan(result.queries.findIndex(sql=>sql.includes("parent_claim_cleanup")));
  expect(result.stdout).toBe("Retention completed: 203 protected packets, 0 private objects and 0 parent memberships erased.\n");expect(result.stderr).toBe("");
  expect(result.queries.some(sql=>/vault\.|ciphertext|keyBase64|owner_id|processing_controls/.test(sql))).toBe(false);
});
it("bounds protected deletion to ten batches without skipping ordinary cleanup",async()=>{
  const result=await localRetention(Array(11).fill(100));
  expect(result.queries.filter(sql=>sql.includes("parent_purge_snap_final_packets"))).toHaveLength(10);
  expect(result.queries.some(sql=>sql.includes("parent_claim_cleanup"))).toBe(true);expect(result.stdout).toContain("1000 protected packets");
});
it.each([-1,101,"1",{key:"PRIVATE_RESULT_CANARY"}])("rejects malformed purge count without exposing it %#",async value=>{
  const result=await localRetention([value]);await vi.waitFor(()=>expect(process.exitCode).toBe(1));
  expect(result.queries.some(sql=>sql.includes("parent_claim_cleanup"))).toBe(false);expect(result.stdout).toBe("");
  expect(result.stderr).toBe("Parent retention failed. Pending erasures remain eligible for safe retry; inspect the protected runtime.\n");
  expect(result.stderr).not.toContain("PRIVATE_RESULT_CANARY");
});

it("runs packet-only cleanup under separate maintenance approval with no Storage/Auth client or ordinary cleanup",async()=>{
  const result=await packetRetention([100,2]);
  expect(result.stdout).toBe("Retention completed: 102 protected packets erased.\n");expect(result.stderr).toBe("");
  expect(mocks.storage).not.toHaveBeenCalled();expect(result.queries.filter(sql=>sql.includes("parent_purge_snap_final_packets"))).toHaveLength(2);
  expect(result.queries.some(sql=>/parent_claim_cleanup|parent_finish_cleanup|processing_controls|vault\.|ciphertext|keyBase64/.test(sql))).toBe(false);
  expect(mocks.destroy).toHaveBeenCalledOnce();expect(mocks.end).toHaveBeenCalledOnce();
  expect(mocks.client.mock.calls[0][0]).toMatchObject({connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
});
it("caps a packet-only invocation at ten batches without claiming ordinary erasure",async()=>{
  const result=await packetRetention(Array(11).fill(100));expect(result.queries.filter(sql=>sql.includes("parent_purge_snap_final_packets"))).toHaveLength(10);
  expect(result.stdout).toBe("Retention completed: 1000 protected packets erased.\n");expect(mocks.storage).not.toHaveBeenCalled();
});
it.each([
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED:undefined},
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED:"0"},
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:undefined},
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:"not-a-date"},
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE:undefined},
  {CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE:" "},
  {CASELINK_PARENT_RETENTION_MODE:"unreviewed"},
  {CASELINK_PARENT_RETENTION_STORAGE_KEY:"UNNEEDED_STORAGE_CANARY"},
])("keeps packet-only mode closed before clients for invalid maintenance settings %#",async env=>{
  const result=await packetRetention([],{env});expect(process.exitCode).toBe(1);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.storage).not.toHaveBeenCalled();
  expect(result.stdout).toBe("");expect(result.stderr).not.toContain("UNNEEDED_STORAGE_CANARY");
});
it("does not substitute a planning deadline for expired or absent maintenance approval",async()=>{
  const result=await packetRetention([],{env:{CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:new Date(Date.now()-1).toISOString(),CASELINK_PARENT_BROWSER_APPROVED_UNTIL:new Date(Date.now()+3600000).toISOString()}});
  expect(process.exitCode).toBe(1);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.storage).not.toHaveBeenCalled();expect(result.stdout).toBe("");
});
it.each([
  "postgresql://synthetic_retention:synthetic@127.0.0.1:54322/postgres",
  "postgresql://synthetic_retention:synthetic@127.0.0.1:55322/other",
  "postgresql://synthetic_retention:synthetic@127.0.0.1:55322/postgres?options=role%3Dservice_role",
])("rejects an unsafe packet-only local database before connecting %#",async connection=>{
  await packetRetention([],{env:{CASELINK_PARENT_RETENTION_DATABASE_URL:connection}});
  expect(process.exitCode).toBe(1);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.storage).not.toHaveBeenCalled();
});
const remoteScope={CASELINK_ENVIRONMENT:"production",CASELINK_PARENT_RETENTION_SUPABASE_URL:"https://approved.supabase.co",CASELINK_PARENT_PRODUCTION_SUPABASE_URL:"https://approved.supabase.co",CASELINK_SCHOOL_SUPABASE_URL:"https://school.supabase.co",CASELINK_PARENT_RETENTION_APPROVED:"1"};
it.each([
  "postgresql://synthetic_retention:synthetic@db.other.supabase.co:5432/postgres?sslmode=verify-full",
  "postgresql://synthetic_retention:synthetic@db.approved.supabase.co:5432/postgres?sslmode=require",
  "postgresql://synthetic_retention:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full&sslmode=disable",
])("rejects a mismatched or unverified packet-only remote database %#",async connection=>{
  await packetRetention([],{env:{...remoteScope,CASELINK_PARENT_RETENTION_DATABASE_URL:connection}});
  expect(process.exitCode).toBe(1);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.storage).not.toHaveBeenCalled();
});
it("requires the existing remote-target approval as well as the separate maintenance approval",async()=>{
  await packetRetention([],{env:{...remoteScope,CASELINK_PARENT_RETENTION_APPROVED:undefined,CASELINK_PARENT_RETENTION_DATABASE_URL:"postgresql://synthetic_retention:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full"}});
  expect(process.exitCode).toBe(1);expect(mocks.client).not.toHaveBeenCalled();
});
it("accepts only the approved remote project with verified TLS in packet-only mode (mocked driver)",async()=>{
  const result=await packetRetention([0],{env:{...remoteScope,CASELINK_PARENT_RETENTION_DATABASE_URL:"postgresql://synthetic_retention:synthetic@db.approved.supabase.co:5432/postgres?sslmode=verify-full"}});
  expect(result.stdout).toBe("Retention completed: 0 protected packets erased.\n");expect(result.stderr).toBe("");expect(mocks.storage).not.toHaveBeenCalled();
});
it.each([
  {rolname:"postgres"},{rolname:"foreign_login"},{rolcanlogin:false},{rolinherit:true},{rolsuper:true},{rolbypassrls:true},
  {rolcreaterole:true},{rolcreatedb:true},{rolreplication:true},{member:false},{can_set:false},{admin_option:true},
  {broader_membership:true},{group_membership:true},{group_login:true},{group_super:true},
])("rejects unsafe retention principal authority before SET ROLE or purge %#",async changes=>{
  const result=await packetRetention([],{principal:{...principal(),...changes}});
  expect(process.exitCode).toBe(1);expect(result.queries).not.toContain("set role parent_retention_worker");expect(result.queries.some(sql=>sql.includes("parent_purge"))).toBe(false);
  expect(mocks.destroy).toHaveBeenCalledOnce();expect(mocks.storage).not.toHaveBeenCalled();
});
it.each(["connect","purge"] as const)("bounds a hanging %s by the maintenance deadline and hard-closes its one connection",async hangAt=>{
  vi.useFakeTimers();
  await packetRetention([],{hangAt,wait:false,env:{CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:new Date(Date.now()+100).toISOString()}});
  await vi.advanceTimersByTimeAsync(100);await vi.waitFor(()=>expect(process.exitCode).toBe(1));
  expect(mocks.destroy).toHaveBeenCalledOnce();expect(mocks.end).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);expect(mocks.storage).not.toHaveBeenCalled();
});
it("bounds packet-only work to one minute even with a later maintenance deadline",async()=>{
  vi.useFakeTimers();await packetRetention([],{hangAt:"purge",wait:false});await vi.advanceTimersByTimeAsync(60000);
  await vi.waitFor(()=>expect(process.exitCode).toBe(1));expect(mocks.destroy).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it("does not claim success for a late purge acknowledgement after maintenance expiry",async()=>{
  vi.useFakeTimers();let complete!:(value:unknown)=>void;const reply=new Promise(resolve=>{complete=resolve;});
  await packetRetention([],{purgeReply:reply,wait:false,env:{CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL:new Date(Date.now()+100).toISOString()}});
  await vi.waitFor(()=>expect(mocks.query.mock.calls.some(([sql])=>String(sql).includes("parent_purge"))).toBe(true));
  vi.setSystemTime(Date.now()+200);complete({rows:[{removed:1}]});await vi.waitFor(()=>expect(process.exitCode).toBe(1));
  expect(process.stdout.write).not.toHaveBeenCalled();expect(mocks.destroy).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it("rejects an unexpected principal reply without echoing its private content",async()=>{
  const result=await packetRetention([],{principal:{...principal(),privateDebug:"PRIVATE_PRINCIPAL_CANARY"}});
  expect(process.exitCode).toBe(1);expect(result.queries.some(sql=>sql.includes("parent_purge"))).toBe(false);expect(result.stderr).not.toContain("PRIVATE_PRINCIPAL_CANARY");
});
it("does not await a hanging end after a known count and leaves no packet-only timer",async()=>{
  vi.useFakeTimers();const result=await packetRetention([1],{hangAt:"end"});
  expect(result.stdout).toBe("Retention completed: 1 protected packets erased.\n");expect(mocks.destroy).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it.each(["connect","purge"] as const)("hides raw %s errors and closes the SQL-only connection",async errorAt=>{
  const result=await packetRetention([],{errorAt});expect(process.exitCode).toBe(1);expect(result.stdout).toBe("");
  expect(result.stderr).toBe("Parent retention failed. Pending erasures remain eligible for safe retry; inspect the protected runtime.\n");
  expect(result.stderr).not.toMatch(/PRIVATE_|synthetic@|SYNTHETIC_STORAGE/);expect(mocks.destroy).toHaveBeenCalledOnce();
});
it("preserves default full Storage cleanup and parent-membership acknowledgement without Auth deletion",async()=>{
  const id="11111111-1111-4111-8111-111111111111",doc="22222222-2222-4222-8222-222222222222",artifact="33333333-3333-4333-8333-333333333333",account="44444444-4444-4444-8444-444444444444";
  const remove=vi.fn().mockResolvedValue({data:[],error:null}),from=vi.fn().mockReturnValue({remove}),deleteUser=vi.fn();
  mocks.storage.mockReturnValueOnce({storage:{from},auth:{admin:{deleteUser}}});
  const result=await localRetention([0],{batch:{batchId:id,leaseToken:doc,documents:[{id:doc,objectPath:`${id}/${doc}/${artifact}`}],artifacts:[{id:artifact,objectPath:`${id}/${artifact}.pdf`}],accountIds:[account],requestIds:[]}});
  expect(from.mock.calls.map(call=>call[0])).toEqual(["parent-documents","parent-form-artifacts"]);expect(remove).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls.find(([sql])=>String(sql).includes("parent_finish_cleanup"))?.[1]).toEqual([id,doc,[doc],[account],[artifact]]);
  expect(deleteUser).not.toHaveBeenCalled();expect(result.stdout).toBe("Retention completed: 0 protected packets, 2 private objects and 1 parent memberships erased.\n");
});

const cleanupId = "11111111-1111-4111-8111-111111111111", cleanupDoc = "22222222-2222-4222-8222-222222222222", cleanupArtifact = "33333333-3333-4333-8333-333333333333";
const cleanupBatch = { batchId: cleanupId, leaseToken: cleanupDoc, documents: [{ id: cleanupDoc, objectPath: `${cleanupId}/${cleanupDoc}/${cleanupArtifact}` }],
  artifacts: [{ id: cleanupArtifact, objectPath: `${cleanupId}/${cleanupArtifact}.pdf` }], accountIds: [cleanupId], requestIds: [] };
const ordinaryRetention = (options: Options = {}) => localRetention([], { ...options, env: {
  CASELINK_PARENT_RETENTION_MODE: "ordinary", CASELINK_PARENT_RETENTION_STORAGE_KEY: undefined,
  CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED: "1", CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE: "Synthetic ordinary maintenance only",
  CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: new Date(Date.now()+3600000).toISOString(),
  CASELINK_PARENT_RETENTION_S3_ACCESS_KEY_ID: "synthetic-s3-access-id", CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY: "synthetic-s3-secret-at-least-20", CASELINK_PARENT_RETENTION_S3_REGION: "local", ...options.env,
} });
it("ordinary-only maintenance uses S3 and exact acknowledgements without protected purge or Auth API", async () => {
  const result = await ordinaryRetention({ batch: cleanupBatch });
  expect(mocks.storage).not.toHaveBeenCalled(); expect(mocks.s3).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(mocks.remove.mock.calls.map(([bucket, path]) => [bucket, path])).toEqual([["parent-documents", cleanupBatch.documents[0].objectPath], ["parent-form-artifacts", cleanupBatch.artifacts[0].objectPath]]);
  expect(mocks.query.mock.calls.find(([sql]) => String(sql).includes("parent_finish_cleanup"))?.[1]).toEqual([cleanupId, cleanupDoc, [cleanupDoc], [cleanupId], [cleanupArtifact]]);
  expect(result.queries.some(sql => sql.includes("parent_purge_snap"))).toBe(false); expect(result.queries).toContain("select parent_private.parent_claim_cleanup(1) batch");
  expect(result.stdout).toContain("2 private objects and 1 parent memberships erased"); expect(mocks.s3Destroy).toHaveBeenCalledOnce();
});
it.each([
  { CASELINK_PARENT_RETENTION_STORAGE_KEY: "SYNTHETIC_API_KEY" },
  { CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY: undefined },
  { CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY: "sb_secret_synthetic-test-key" },
  { CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED: undefined },
  { CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: "2000-01-01T00:00:00Z" },
  { ...remoteScope, CASELINK_PARENT_RETENTION_DATABASE_URL: "postgresql://synthetic_retention:synthetic@db.other.supabase.co/postgres?sslmode=verify-full" },
])("ordinary maintenance rejects missing authority or broad/wrong credentials before clients %#", async env => {
  await ordinaryRetention({ env }); expect(process.exitCode).toBe(1); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.s3).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
});
it("ordinary maintenance refuses broad SQL role authority before any deletion", async () => {
  await ordinaryRetention({ principal: { ...principal(), broader_membership: true }, batch: cleanupBatch });
  expect(process.exitCode).toBe(1); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.s3Destroy).toHaveBeenCalledOnce();
});
it("failed Storage erasure leaves its lease unacknowledged and hides private errors", async () => {
  mocks.remove.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_CANARY"));
  const result = await ordinaryRetention({ batch: cleanupBatch });
  expect(process.exitCode).toBe(1); expect(result.queries.some(sql => sql.includes("parent_finish_cleanup"))).toBe(false);
  expect(mocks.remove).toHaveBeenCalledOnce(); expect(result.stderr).not.toContain("PRIVATE_PROVIDER_CANARY"); expect(mocks.s3Destroy).toHaveBeenCalledOnce();
});
it.each([100, 60000])("ordinary maintenance cancels a hanging Storage operation at its bounded deadline %i", async deadline => {
  vi.useFakeTimers(); mocks.remove.mockImplementation(() => new Promise(() => {}));
  await ordinaryRetention({ batch: cleanupBatch, wait: false, env: { CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: new Date(Date.now() + (deadline === 100 ? 100 : 3600000)).toISOString() } });
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce()); const signal = mocks.remove.mock.calls[0][2] as AbortSignal;
  await vi.advanceTimersByTimeAsync(deadline); await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(signal.aborted).toBe(true); expect(mocks.s3Destroy).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("parent_finish_cleanup"))).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it("ordinary cleanup cannot acknowledge a late success after its original maintenance authority expired", async () => {
  vi.useFakeTimers(); let finish!: () => void; mocks.remove.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await ordinaryRetention({ batch: cleanupBatch, wait: false, env: { CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL: new Date(Date.now()+100).toISOString() } });
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce()); vi.setSystemTime(Date.now()+200); finish();
  await vi.waitFor(() => expect(process.exitCode).toBe(1)); expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("parent_finish_cleanup"))).toBe(false);
});
it("ordinary cleanup rejects oversized batches before Storage deletion", async () => {
  await ordinaryRetention({ batch: { ...cleanupBatch, documents: [...cleanupBatch.documents, ...cleanupBatch.documents] } });
  expect(process.exitCode).toBe(1); expect(mocks.remove).not.toHaveBeenCalled();
});
it("protected-only cleanup rejects injected S3 credentials", async () => {
  await packetRetention([], { env: { CASELINK_PARENT_RETENTION_S3_ACCESS_KEY_ID: "synthetic-s3-access-id" } });
  expect(process.exitCode).toBe(1); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.s3).not.toHaveBeenCalled();
});

it.each(["SIGTERM", "SIGINT"] as const)("ordinary maintenance cancels in-flight deletion on %s and removes its handlers", async signalName => {
  const listeners = process.listenerCount(signalName), once = vi.spyOn(process, "once");
  mocks.remove.mockImplementation(() => new Promise(() => {}));
  await ordinaryRetention({ batch: cleanupBatch, wait: false });
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  const handler = once.mock.calls.find(([name]) => name === signalName)?.[1]; expect(handler).toBeTypeOf("function"); handler!();
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect((mocks.remove.mock.calls[0][2] as AbortSignal).aborted).toBe(true); expect(mocks.s3Destroy).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("parent_finish_cleanup"))).toBe(false);
  expect(process.listenerCount(signalName)).toBe(listeners);
});

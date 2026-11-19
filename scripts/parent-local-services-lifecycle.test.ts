import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), client: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("pg", async (original) => ({ ...await original<typeof import("pg")>(), Client: vi.fn(function (options) { return mocks.client(options); }) }));
import { localServicesSchema, runLocalServices, verifyLocalLogins } from "./parent-local-services";
import { parseSnapPrivateServices } from "./parent-snap-services";

const config = () => localServicesSchema.parse({
  projectUrl: "http://127.0.0.1:55321", approvedUntil: new Date(Date.now() + 60000).toISOString(),
  modelBudgetStartedAt: new Date(Date.now() - 1000).toISOString(), modelCallLimit: 12,
  workerDatabaseUrl: "postgresql://caselink_parent_local_worker:synthetic@127.0.0.1:55322/postgres",
  brokerDatabaseUrl: "postgresql://caselink_parent_local_broker:synthetic@127.0.0.1:55322/postgres",
  s3AccessKeyId: "synthetic-s3-access-id", s3SecretAccessKey: "synthetic-s3-secret-at-least-20", s3Region: "local",
  brokerSecret: "synthetic-broker-secret-with-32-characters",
});
const key = "synthetic-openai-key-at-least-20";
function snapConfig() { return parseSnapPrivateServices({ approvalReference: "offline fixture only", approvedUntil: new Date(Date.now() + 30000).toISOString(),
  publicOrigin: "http://127.0.0.1:3200", appOrigin: "http://127.0.0.1:3201", senderOrigin: "http://127.0.0.1:3340", reviewOrigin: "http://127.0.0.1:3341",
  supabaseOrigin: "http://127.0.0.1:55321", supabasePublicKey: "sb_publishable_fixture",
  senderDatabaseUrl: "postgresql://caselink_sender:SENDER_PRIVATE@127.0.0.1:55322/postgres", finalizerDatabaseUrl: "postgresql://caselink_finalizer:FINALIZER_PRIVATE@127.0.0.1:55322/postgres",
  senderSecret: "sender-private-token-".repeat(3), carrier: { projectId: "project", serviceId: "service", fromNumber: "+12155550101", accessKey: "access", secretKey: "CARRIER_PRIVATE",
    destinations: [{ id: "office", version: "v1", number: "+12155550102", verifiedUntil: new Date(Date.now() + 60000).toISOString() }] },
}); }
class Child extends EventEmitter {
  kill = vi.fn(() => { this.emit("exit", 0); return true; });
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(process.stdout, "write").mockImplementation(() => true); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("settles a worker spawn error with no exit event and stops the broker without leaving its deadline active", async () => {
  vi.useFakeTimers();
  const broker = new Child(), worker = new Child();
  mocks.spawn.mockReturnValueOnce(broker).mockImplementationOnce(() => {
    queueMicrotask(() => worker.emit("error", new Error("synthetic EAGAIN")));
    return worker;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }));
  await expect(runLocalServices(config(), key)).rejects.toThrow("local private service stopped");
  expect(broker.kill).toHaveBeenCalledWith("SIGTERM");
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
}, 1000);

it.each(["broker exit", "SIGTERM", "deadline"])("never starts a worker after %s during the health response", async (reason) => {
  vi.useFakeTimers();
  const broker = new Child(); mocks.spawn.mockReturnValue(broker);
  let signalStop: (() => void) | undefined;
  vi.spyOn(process, "once").mockImplementation((event, listener) => {
    if (event === "SIGTERM") signalStop = listener as () => void;
    return process;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => {
    if (reason === "broker exit") broker.emit("exit", 1);
    else if (reason === "SIGTERM") signalStop?.();
    else await vi.advanceTimersByTimeAsync(60001);
    return { ready: true };
  } }));
  await expect(runLocalServices(config(), key)).rejects.toThrow("before shutdown");
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  if (reason !== "broker exit") expect(broker.kill).toHaveBeenCalledWith("SIGTERM");
  expect(vi.getTimerCount()).toBe(0);
});

it("checks both stored credential logins, narrow role memberships and actual SET ROLE before claiming setup is ready", async () => {
  const clients = ["worker", "broker"].map((service) => {
    const group = service === "worker" ? "parent_worker" : "parent_storage_broker";
    return { connect: vi.fn().mockResolvedValue(undefined), end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (sql: string) => ({ rows: sql.includes("from pg_roles") ? [{
        rolname: `caselink_parent_local_${service}`, rolcanlogin: true, member: true,
        rolinherit: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false,
        rolcreatedb: false, rolreplication: false, broader_membership: false,
      }] : [{ name: group }] })),
    };
  });
  mocks.client.mockReturnValueOnce(clients[0]).mockReturnValueOnce(clients[1]);
  const input = config(); await verifyLocalLogins(input);
  expect(mocks.client.mock.calls.map(([options]) => options.connectionString)).toEqual([input.workerDatabaseUrl, input.brokerDatabaseUrl]);
  expect(clients[0].query).toHaveBeenCalledWith("set role parent_worker");
  expect(clients[1].query).toHaveBeenCalledWith("set role parent_storage_broker");
  expect(clients.every((client) => client.connect.mock.calls.length === 1 && client.end.mock.calls.length === 1)).toBe(true);
});

it.each(["wrong password", "broad membership"])("does not certify saved credentials with %s", async (reason) => {
  const client = { connect: reason === "wrong password" ? vi.fn().mockRejectedValue(new Error("authentication failed")) : vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue({ rows: [{
      rolname: "caselink_parent_local_worker", rolcanlogin: true, member: true,
      rolinherit: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false,
      rolcreatedb: false, rolreplication: false, broader_membership: true,
    }] }),
  };
  mocks.client.mockReturnValue(client);
  await expect(verifyLocalLogins(config())).rejects.toThrow();
  expect(client.end).toHaveBeenCalledOnce();
  expect(mocks.client).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls.some(([sql]) => sql.startsWith("set role"))).toBe(false);
});

it("starts isolated sender/review/frontdoor before giving the ordinary worker metadata-only access", async () => {
  vi.useFakeTimers();
  const children: Child[] = [];
  mocks.spawn.mockImplementation((_program, args: string[]) => {
    const child = new Child(); children.push(child);
    const service = args.at(-1);
    if (service?.startsWith("snap-")) queueMicrotask(() => child.emit("message", { ready: true, service }));
    if (service === "--watch") queueMicrotask(() => child.emit("exit", 0));
    return child;
  });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }); vi.stubGlobal("fetch", fetcher);
  await runLocalServices(config(), key, snapConfig());
  expect(mocks.spawn.mock.calls.map(([, args]) => args.at(-1))).toEqual([
    expect.stringContaining("parent-storage-broker.ts"), "snap-sender", "snap-review", "snap-frontdoor", "--watch",
  ]);
  const worker = mocks.spawn.mock.calls[4][2].env;
  expect(worker.CASELINK_PARENT_SNAP_SENDER_ORIGIN).toBe("http://127.0.0.1:3340");
  expect(worker.CASELINK_PARENT_SNAP_SENDER_SECRET).toBe(snapConfig().senderSecret);
  expect(JSON.stringify(worker)).not.toMatch(/CARRIER_PRIVATE|SENDER_PRIVATE|FINALIZER_PRIVATE/);
  const review = JSON.stringify(mocks.spawn.mock.calls[2][2].env), frontdoor = JSON.stringify(mocks.spawn.mock.calls[3][2].env);
  expect(review).not.toMatch(/CARRIER_PRIVATE|SENDER_PRIVATE|sender-private-token/);
  expect(frontdoor).not.toMatch(/CARRIER_PRIVATE|SENDER_PRIVATE|FINALIZER_PRIVATE|sender-private-token/);
  expect(fetcher.mock.calls.every(([url]) => url === "http://127.0.0.1:3310/health")).toBe(true);
  expect(children.slice(0, 4).every(child => child.kill.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["wrong readiness", "sender exit"])("does not start the worker after private %s", async reason => {
  vi.useFakeTimers();
  const children: Child[] = [];
  mocks.spawn.mockImplementation((_program, args: string[]) => {
    const child = new Child(); children.push(child);
    const service = args.at(-1);
    if (service === "snap-sender") queueMicrotask(() => reason === "sender exit" ? child.emit("exit", 1) : child.emit("message", { ready: true, service: "wrong" }));
    if (service === "snap-review") queueMicrotask(() => child.emit("message", { ready: true, service }));
    return child;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }));
  await expect(runLocalServices(config(), key, snapConfig())).rejects.toThrow();
  expect(mocks.spawn).toHaveBeenCalledTimes(3);
  expect(mocks.spawn.mock.calls.some(([, args]) => args.includes("--watch"))).toBe(false);
  expect(children[0].kill).toHaveBeenCalledWith("SIGTERM"); expect(vi.getTimerCount()).toBe(0);
});

it("a private approval can only shorten the existing local runtime and shuts down all owned processes", async () => {
  vi.useFakeTimers();
  const base = config(), snap = snapConfig(), expiry = base.approvedUntil, children: Child[] = [];
  mocks.spawn.mockImplementation((_program, args: string[]) => {
    const child = new Child(); children.push(child);
    const service = args.at(-1);
    if (service?.startsWith("snap-")) queueMicrotask(() => child.emit("message", { ready: true, service }));
    return child;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }));
  const running = runLocalServices(base, key, snap);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(5));
  await vi.advanceTimersByTimeAsync(30001); await running;
  expect(base.approvedUntil).toBe(expiry); expect(children.every(child => child.kill.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("gives all private children the earlier main deadline even if their separate approval lasts longer", async () => {
  vi.useFakeTimers();
  const base = config(), snap = { ...snapConfig(), approvedUntil: new Date(Date.now() + 120000).toISOString() }, originalExpiry = snap.approvedUntil;
  mocks.spawn.mockImplementation((_program, args: string[]) => {
    const child = new Child(), service = args.at(-1);
    if (service?.startsWith("snap-")) queueMicrotask(() => child.emit("message", { ready: true, service }));
    return child;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }));
  const running = runLocalServices(base, key, snap);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(5));
  const privateCalls = mocks.spawn.mock.calls.filter(([, args]) => args.at(-1)?.startsWith("snap-"));
  expect(privateCalls.map(([, args]) => args.at(-1))).toEqual(["snap-sender", "snap-review", "snap-frontdoor"]);
  for (const [, , options] of privateCalls) expect(JSON.parse(options.env.CASELINK_PARENT_SNAP_PRIVATE_CHILD).approvedUntil).toBe(base.approvedUntil);
  expect(snap.approvedUntil).toBe(originalExpiry);
  await vi.advanceTimersByTimeAsync(60001); await running; expect(vi.getTimerCount()).toBe(0);
});

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parentAppBind } from "./parent-app-bind.mjs";

const mocks = vi.hoisted(() => {
  const env = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200", CASELINK_PARENT_RECOVERY_SITE_URL: "https://original.example.test" };
  return { env, child: { once: vi.fn(), kill: vi.fn() }, spawn: vi.fn(), read: vi.fn(), connected: vi.fn(() => env), preview: vi.fn(() => env) };
});
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: () => false, mkdirSync: vi.fn(), readFileSync: mocks.read, writeFileSync: vi.fn() }));
vi.mock("./parent-connected-environment", () => ({ parentConnectedEnvironment: mocks.connected }));
vi.mock("./parent-test-environment.mjs", () => ({ parentTestEnvironment: mocks.preview }));
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  mocks.spawn.mockReturnValue(mocks.child);
  const fingerprint = createHash("sha256").update(JSON.stringify(mocks.env)).digest("hex");
  mocks.read.mockImplementation((path: string) => path === "tmp/parent-connected-build.json"
    ? JSON.stringify({ fingerprint, buildId: "synthetic-build" }) : "synthetic-build");
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks();
});

describe("serve-only parent app listener", () => {
  it("keeps the existing default and accepts the isolated internal app origin", () => {
    expect(parentAppBind({})).toEqual({ origin: "http://127.0.0.1:3200", hostname: "127.0.0.1", port: "3200" });
    expect(parentAppBind({ CASELINK_PARENT_APP_BIND_ORIGIN: "http://127.0.0.1:3201" })).toEqual({ origin: "http://127.0.0.1:3201", hostname: "127.0.0.1", port: "3201" });
  });
  it.each(["", "http://0.0.0.0:3201", "http://localhost:3201", "https://127.0.0.1:3201", "http://other.example:3201", "http://user:secret@127.0.0.1:3201",
    "http://127.0.0.1:80", "http://127.0.0.1:65536", "http://127.0.0.1:03201", "http://127.0.0.1:3201/", "http://127.0.0.1:3201?key=secret", "http://127.0.0.1:3201#private"])("rejects unsafe or noncanonical listener %s", origin => {
    expect(() => parentAppBind({ CASELINK_PARENT_APP_BIND_ORIGIN: origin })).toThrow("app listener origin");
  });
  it.each([undefined, "http://127.0.0.1:3201"])("binds the preview to %s without forwarding private or listener settings to Next", async origin => {
    vi.stubEnv("CASELINK_PARENT_APP_BIND_ORIGIN", origin);
    vi.stubEnv("CASELINK_PARENT_SNAP_PRIVATE_CHILD", "PRIVATE_CONFIG_CANARY");
    process.argv = ["node", "scripts/serve-parent.mjs"];
    await import("./serve-parent.mjs");
    const [, args, options] = mocks.spawn.mock.calls[0];
    expect(args).toEqual(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", origin ? "3201" : "3200"]);
    expect(options.env).toEqual(mocks.env);
    expect(JSON.stringify(options.env)).not.toMatch(/APP_BIND|SNAP_PRIVATE|PRIVATE_CONFIG_CANARY/);
  });
  it("binds connected serve internally while preserving the built public profile and recovery site", async () => {
    vi.stubEnv("CASELINK_PARENT_APP_BIND_ORIGIN", "http://127.0.0.1:3201");
    vi.stubEnv("CASELINK_PARENT_SNAP_PRIVATE_CHILD", "PRIVATE_CONFIG_CANARY");
    process.argv = ["node", "scripts/parent-connected.ts", "serve"];
    await import("./parent-connected");
    const [, args, options] = mocks.spawn.mock.calls[0];
    expect(args).toEqual(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3201"]);
    expect(options.env).toEqual(mocks.env);
    expect(options.env.NEXT_PUBLIC_SITE_URL).toBe("http://127.0.0.1:3200");
    expect(options.env.CASELINK_PARENT_RECOVERY_SITE_URL).toBe("https://original.example.test");
    expect(JSON.stringify(options.env)).not.toMatch(/APP_BIND|SNAP_PRIVATE|PRIVATE_CONFIG_CANARY/);
  });
  it("ignores the serve-only setting during connected build", async () => {
    vi.stubEnv("CASELINK_PARENT_APP_BIND_ORIGIN", "https://outside.example:3201");
    process.argv = ["node", "scripts/parent-connected.ts", "build"];
    await import("./parent-connected");
    expect(mocks.spawn).toHaveBeenCalledWith("npm", ["run", "build"], { env: mocks.env, stdio: "inherit" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects an unsafe serve binding before file configuration or child launch", async () => {
    vi.stubEnv("CASELINK_PARENT_APP_BIND_ORIGIN", "https://outside.example:3201");
    process.argv = ["node", "scripts/parent-connected.ts", "serve"];
    await expect(import("./parent-connected")).rejects.toThrow("app listener origin");
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationRequiredError,
  SessionUnavailableError,
} from "@/lib/auth/session-errors";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./config", () => ({
  getParentConfig: mocks.config,
}));
afterEach(() => vi.unstubAllEnvs());
/* Validated configuration is exercised independently in config.test.ts. */
const localConfig = {
  supabaseUrl: "http://127.0.0.1:55321",
  supabaseKey: "sb_publishable_test",
};
import {
  createParentClient,
  getParentSession,
  requireParentSession,
} from "./auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue(localConfig);
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "owner",
        email: "parent@example.test",
        email_confirmed_at: "2026-10-25",
        is_anonymous: false,
      },
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: "household", error: null });
});
describe("verified parent session", () => {
  it("keeps hosted cookies Secure and permits only the separately validated connected loopback exception", async () => {
    mocks.config.mockReturnValue({
      ...localConfig,
      supabaseUrl: "https://existing.supabase.co",
    });
    for (const [environment, secure] of [
      ["production", true],
      ["connected", false],
    ] as const) {
      vi.stubEnv("CASELINK_ENVIRONMENT", environment);
      await createParentClient();
      expect(mocks.createClient.mock.lastCall?.[2].cookieOptions).toMatchObject(
        { secure, httpOnly: true, sameSite: "lax" },
      );
    }
  });
  it("uses the validated auth user and database live-session/account boundary", async () => {
    expect((await requireParentSession()).user).toEqual({
      id: "owner",
      email: "parent@example.test",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_ensure_account");
  });
  it("does not provision anonymous or unverified accounts", async () => {
    for (const user of [
      {
        id: "x",
        email: "x@example.test",
        is_anonymous: true,
        email_confirmed_at: "date",
      },
      { id: "x", email: "x@example.test", email_confirmed_at: null },
    ]) {
      mocks.getUser.mockResolvedValue({ data: { user }, error: null });
      expect(await getParentSession()).toBeNull();
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects sessions or accounts denied by the database identity boundary", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await getParentSession()).toBeNull();
    await expect(requireParentSession()).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
  });
  it("distinguishes unavailable authentication from being signed out", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });
    await expect(getParentSession()).rejects.toBeInstanceOf(
      SessionUnavailableError,
    );
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    expect(await getParentSession()).toBeNull();
  });
  it("isolates parent cookies and uses a bounded network transport", async () => {
    await createParentClient();
    const options = mocks.createClient.mock.calls[0][2];
    expect(options.cookieOptions).toMatchObject({
      name: "caselink-parent-auth",
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
    expect(options.global.fetch).toBeTypeOf("function");
  });
});

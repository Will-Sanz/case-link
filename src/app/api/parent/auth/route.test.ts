import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  password: vi.fn(),
  getUser: vi.fn(),
  code: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/parent/auth", () => ({ createParentClient: mocks.create }));
import { POST } from "./route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.example.test");
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "isolated");
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({
    auth: {
      signInWithPassword: mocks.password,
      getUser: mocks.getUser,
      signInWithOtp: mocks.code,
      verifyOtp: mocks.verify,
      signOut: mocks.signOut,
    },
    rpc: mocks.rpc,
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111", email: "synthetic@example.test", email_confirmed_at: "2026-11-07", is_anonymous: false } }, error: null });
  for (const operation of [
    mocks.password,
    mocks.code,
    mocks.verify,
    mocks.signOut,
    mocks.rpc,
  ])
    operation.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());
const request = (value: unknown, origin = "https://caselink.example.test") =>
  new Request("https://caselink.example.test/api/parent/auth", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(value),
  });

describe("existing parent account sign-in", () => {
  it("blocks unconfigured existing-project code enrollment before calling Auth and preserves password sign-in", async () => {
    vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
    vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "0");
    for (const action of ["send_code", "verify_code"])
      expect(
        (
          await POST(
            request({
              action,
              email: "synthetic@example.test",
              ...(action === "verify_code" ? { token: "123456" } : {}),
            }),
          )
        ).status,
      ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(
      (
        await POST(
          request({
            action: "sign_in",
            email: "synthetic@example.test",
            password: "synthetic-password",
          }),
        )
      ).status,
    ).toBe(200);
    vi.stubEnv("CASELINK_PARENT_EMAIL_CODE_ENABLED", "1");
    expect(
      (
        await POST(
          request({ action: "send_code", email: "synthetic@example.test" }),
        )
      ).status,
    ).toBe(200);
  });
  it.each(["verify_code", "sign_in"])(
    "keeps %s retryable during an Auth outage without provisioning an account",
    async (action) => {
      const operation =
        action === "verify_code" ? mocks.verify : mocks.password;
      operation.mockResolvedValue({
        error: { status: 503, message: "private provider detail" },
      });
      const result = await POST(
        request({
          action,
          email: "new-parent@example.test",
          ...(action === "verify_code"
            ? { token: "123456" }
            : { password: "synthetic-password" }),
        }),
      );
      expect(result.status).toBe(503);
      expect(await result.text()).toContain("temporarily unavailable");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([503, 500, 0, undefined])(
    "does not claim a code was sent after an Auth service failure (%s)",
    async (status) => {
      mocks.code.mockResolvedValue({
        error: { status, message: "private provider detail" },
      });
      const result = await POST(
        request({ action: "send_code", email: "new-parent@example.test" }),
      );
      expect(result.status).toBe(503);
      const body = await result.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain("temporarily unavailable");
      expect(JSON.stringify(body)).not.toContain("private provider detail");
    },
  );
  it.each(["send_code", "sign_in"])(
    "fails closed with useful help when %s requires an unsupported verification challenge",
    async (action) => {
      const mock = action === "send_code" ? mocks.code : mocks.password;
      mock.mockResolvedValue({
        error: {
          status: 400,
          code: "captcha_failed",
          message: "private provider detail",
        },
      });
      const result = await POST(
        request({
          action,
          email: "new-parent@example.test",
          ...(action === "sign_in" ? { password: "synthetic-password" } : {}),
        }),
      );
      expect(result.status).toBe(503);
      const body = await result.json();
      expect(body.error).toContain("direct support options");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("requests a new-parent email code without returning credentials or account existence", async () => {
    const result = await POST(
      request({ action: "send_code", email: "new-parent@example.test" }),
    );
    expect(result.status).toBe(200);
    expect(mocks.code).toHaveBeenCalledWith({
      email: "new-parent@example.test",
      options: { shouldCreateUser: true, captchaToken: undefined },
    });
    expect(await result.json()).toEqual({
      ok: true,
      message: "If this email can receive a code, it will arrive shortly.",
    });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("completes code entry only after database approval of the verified identity", async () => {
    const result = await POST(
      request({
        action: "verify_code",
        email: "new-parent@example.test",
        token: "123456",
      }),
    );
    expect(result.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      email: "new-parent@example.test",
      token: "123456",
      type: "email",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_ensure_account");
    expect(await result.json()).toEqual({ ok: true });
  });
  it("rejects expired or invalid codes before provisioning a household", async () => {
    mocks.verify.mockResolvedValue({
      error: { status: 403, message: "private provider detail" },
    });
    const result = await POST(
      request({
        action: "verify_code",
        email: "new-parent@example.test",
        token: "123456",
      }),
    );
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("incorrect or expired");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("gives a retry instruction when the provider throttles a code request", async () => {
    mocks.code.mockResolvedValue({
      error: { status: 429, message: "private provider detail" },
    });
    const result = await POST(
      request({ action: "send_code", email: "new-parent@example.test" }),
    );
    expect(result.status).toBe(429);
    expect(await result.text()).toContain("wait a minute");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("authenticates the existing password and checks parent ownership before completing sign-in", async () => {
    const result = await POST(
      request({
        action: "sign_in",
        email: "Existing@Example.test",
        password: "synthetic-password",
      }),
    );
    expect(result.status).toBe(200);
    expect(mocks.password).toHaveBeenCalledWith({
      email: "existing@example.test",
      password: "synthetic-password",
      options: { captchaToken: undefined },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_ensure_account");
    expect(mocks.code).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.text()).not.toContain("synthetic-password");
  });
  it("does not disclose whether credentials or the account exist", async () => {
    mocks.password.mockResolvedValue({
      error: { status: 400, message: "private provider detail" },
    });
    const result = await POST(
      request({
        action: "sign_in",
        email: "existing@example.test",
        password: "incorrect",
      }),
    );
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("Check your email and password");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("honors provider rate limits without exposing the provider message", async () => {
    mocks.password.mockResolvedValue({
      error: { status: 429, message: "private provider detail" },
    });
    const result = await POST(
      request({
        action: "sign_in",
        email: "existing@example.test",
        password: "incorrect",
      }),
    );
    expect(result.status).toBe(429);
    expect(await result.text()).not.toContain("private provider detail");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", 403],
    ["08006", 503],
  ])(
    "fails closed when parent access is denied or unavailable (%s)",
    async (code, status) => {
      mocks.rpc.mockResolvedValue({ error: { code } });
      const result = await POST(
        request({
          action: "sign_in",
          email: "existing@example.test",
          password: "synthetic-password",
        }),
      );
      expect(result.status).toBe(status);
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    },
  );
  it("keeps code-based entry behind the same parent database checks", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
    const result = await POST(
      request({
        action: "verify_code",
        email: "existing@example.test",
        token: "123456",
      }),
    );
    expect(result.status).toBe(403);
    expect(mocks.verify).toHaveBeenCalledWith({
      email: "existing@example.test",
      token: "123456",
      type: "email",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("rejects cross-origin and invalid password payloads before contacting Auth", async () => {
    expect(
      (
        await POST(
          request(
            {
              action: "sign_in",
              email: "existing@example.test",
              password: "synthetic",
            },
            "https://other.test",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({
            action: "sign_in",
            email: "existing@example.test",
            password: "",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            action: "sign_in",
            email: "existing@example.test",
            password: "synthetic",
            role: "admin",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("signs out only this parent session", async () => {
    expect((await POST(request({ action: "sign_out" }))).status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});


describe("password-only sign-in for existing parent deletion", () => {
  const input = { action: "sign_in_for_deletion", email: "synthetic@example.test", password: "synthetic-password" };
  it.each(["active", "deletion_requested"])("authenticates an existing %s owner without enrollment or a processing grant", async status => {
    mocks.rpc.mockResolvedValue({ data: status, error: null });
    const result = await POST(request(input));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(mocks.rpc.mock.calls).toEqual([["parent_get_deletion_status"]]);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.code).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("uses the same generic response for incorrect passwords and absent owned parent data", async () => {
    mocks.password.mockResolvedValueOnce({ error: { status: 400, message: "PRIVATE-CANARY" } });
    const invalid = await POST(request(input));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "PRIVATE-CANARY" } });
    const unowned = await POST(request(input));
    expect(invalid.status).toBe(400); expect(unowned.status).toBe(400);
    expect(await unowned.json()).toEqual(await invalid.json());
    expect(mocks.signOut.mock.calls).toEqual([[{ scope: "local" }]]);
  });
  it.each([429, 503])("keeps Auth rate limits/outages (%s) and never proceeds to ownership after failed authentication", async status => {
    mocks.password.mockResolvedValueOnce({ error: { status, message: "PRIVATE-CANARY" } });
    const result = await POST(request(input));
    expect(result.status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain("PRIVATE-CANARY");
  });
  it("keeps origin, password and strict-body controls before Auth", async () => {
    for (const req of [request(input,"https://attacker.example.test"),request({action:"sign_in_for_deletion",email:input.email,token:"123456"}),request({...input,ownerId:"another-parent"})])
      expect((await POST(req)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

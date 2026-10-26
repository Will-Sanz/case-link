import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStorageBroker,
  type StorageBrokerPorts,
  type StoragePurpose,
} from "./storage-broker";
const secret = "separate-synthetic-broker-secret-32-characters";
const purpose: StoragePurpose = {
  jobId: "11111111-1111-4111-8111-111111111111",
  leaseToken: "22222222-2222-4222-8222-222222222222",
  bucket: "parent-form-artifacts",
  objectPath:
    "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.pdf",
  mode: "upload",
};
const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic bounded form\n");
const digest = createHash("sha256").update(bytes).digest("hex");
let clock: number;
let ports: StorageBrokerPorts;
function broker() {
  return createStorageBroker({
    secret,
    origin: "http://127.0.0.1:3310",
    supabaseOrigin: "http://127.0.0.1:55321",
    ports,
    now: () => clock,
  });
}
function grantRequest(body: unknown = purpose, auth = secret) {
  return new Request("http://127.0.0.1:3310/objects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  clock = 1000000;
  ports = {
    authorize: vi.fn(async (value) => ({
      bucket: value.bucket,
      objectPath: value.objectPath,
      mediaType: "application/pdf",
      maxBytes: 10485760,
      expectedSha256: digest,
    })),
    signDownload: vi.fn(
      async () =>
        "http://127.0.0.1:55321/storage/v1/object/sign/parent-documents/file?token=synthetic",
    ),
    upload: vi.fn(async () => {}),
  };
});
describe("isolated purpose-bound storage broker", () => {
  it("rejects credentials and URL paths at the broker boundary", () => {
    expect(() =>
      createStorageBroker({
        secret,
        origin: "https://secret@broker.example.test",
        supabaseOrigin: "https://parent.supabase.co",
        ports,
      }),
    ).toThrow("canonical");
    expect(() =>
      createStorageBroker({
        secret,
        origin: "http://127.0.0.1:3310",
        supabaseOrigin: "https://parent.supabase.co/another",
        ports,
      }),
    ).toThrow("canonical");
  });
  it("authenticates before parsing and rejects unknown fields and paths", async () => {
    const handle = broker();
    expect((await handle(grantRequest(purpose, "wrong"))).status).toBe(401);
    expect(
      (await handle(grantRequest({ ...purpose, objectPath: "../other" })))
        .status,
    ).toBe(400);
    expect(
      (
        await handle(
          grantRequest({
            ...purpose,
            arbitraryDestination: "https://example.test",
          }),
        )
      ).status,
    ).toBe(400);
    expect(ports.authorize).not.toHaveBeenCalled();
  });
  it("uses 30-second exact downloads and rejects destinations outside parent storage", async () => {
    const handle = broker();
    const response = await handle(
      grantRequest({
        ...purpose,
        bucket: "parent-documents",
        mode: "download",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(ports.signDownload).toHaveBeenCalledWith(
      "parent-documents",
      purpose.objectPath,
      30,
    );
    vi.mocked(ports.signDownload).mockResolvedValueOnce(
      "https://unapproved.example.test/collect",
    );
    expect(
      (await handle(grantRequest({ ...purpose, mode: "download" }))).status,
    ).toBe(403);
  });
  it("returns only a short-lived broker upload grant and checks registered bytes before upload", async () => {
    const handle = broker();
    const grant = await (await handle(grantRequest())).json();
    expect(grant.signedUrl).toBe("http://127.0.0.1:3310/uploads");
    expect(grant).not.toHaveProperty("storageKey");
    const result = await handle(
      new Request(grant.signedUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${grant.token}` },
        body: bytes,
      }),
    );
    expect(result.status).toBe(200);
    expect(ports.authorize).toHaveBeenCalledTimes(3);
    expect(ports.upload).toHaveBeenCalledWith(
      purpose.bucket,
      purpose.objectPath,
      Buffer.from(bytes),
      "application/pdf",
    );
  });
  it("rejects forged, expired and revoked grants without sending bytes", async () => {
    const handle = broker();
    const grant = await (await handle(grantRequest())).json();
    expect(
      (
        await handle(
          new Request(grant.signedUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${grant.token}x` },
            body: bytes,
          }),
        )
      ).status,
    ).toBe(401);
    clock += 30001;
    expect(
      (
        await handle(
          new Request(grant.signedUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${grant.token}` },
            body: bytes,
          }),
        )
      ).status,
    ).toBe(401);
    clock -= 30001;
    vi.mocked(ports.authorize).mockRejectedValueOnce(new Error("revoked"));
    expect(
      (
        await handle(
          new Request(grant.signedUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${grant.token}` },
            body: bytes,
          }),
        )
      ).status,
    ).toBe(409);
    expect(ports.upload).not.toHaveBeenCalled();
  });
  it("blocks changed bytes and oversized chunked bodies", async () => {
    const handle = broker();
    const grant = await (await handle(grantRequest())).json();
    expect(
      (
        await handle(
          new Request(grant.signedUrl, {
            method: "PUT",
            headers: { Authorization: `Bearer ${grant.token}` },
            body: new TextEncoder().encode("%PDF-different"),
          }),
        )
      ).status,
    ).toBe(400);
    const oversized = new Request("http://127.0.0.1:3310/objects", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      body: " ".repeat(4097),
    });
    expect((await handle(oversized)).status).toBe(400);
    expect(ports.upload).not.toHaveBeenCalled();
  });
  it("rechecks revocation after reading the bytes and keeps failures content-free", async () => {
    const handle = broker();
    const grant = await (await handle(grantRequest())).json();
    vi.mocked(ports.authorize)
      .mockResolvedValueOnce({
        bucket: purpose.bucket,
        objectPath: purpose.objectPath,
        mediaType: "application/pdf",
        maxBytes: 10485760,
        expectedSha256: digest,
      })
      .mockRejectedValueOnce(new Error("private database detail"));
    const response = await handle(
      new Request(grant.signedUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${grant.token}` },
        body: bytes,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private database detail");
    expect(ports.upload).not.toHaveBeenCalled();
  });
});

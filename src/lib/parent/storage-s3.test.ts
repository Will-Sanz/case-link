import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createS3Storage, s3StorageCredentialsSchema, storageArtifactGuardReady } from "./storage-s3";

const config = { projectUrl: "http://127.0.0.1:55321", s3AccessKeyId: "synthetic-s3-access-id", s3SecretAccessKey: "synthetic-s3-secret-at-least-20", s3Region: "local" };
const bytes = Buffer.from("%PDF-synthetic-test");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Storage-only S3 ports", () => {
  it.each(["sb_secret_synthetic-test-key", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"])("rejects a project API credential", secret => {
    expect(() => createS3Storage({ ...config, s3SecretAccessKey: secret })).toThrow();
  });
  it("requires dedicated credentials and rejects arbitrary endpoints and regions", () => {
    expect(s3StorageCredentialsSchema.safeParse({ s3AccessKeyId: config.s3AccessKeyId, s3Region: "local" }).success).toBe(false);
    expect(() => createS3Storage({ ...config, projectUrl: "https://secret@example.test/path" })).toThrow("origin");
    expect(() => createS3Storage({ ...config, s3Region: "local/other" })).toThrow();
  });
  it("uses the real standard signer for an exact 30-second object without making a network call", async () => {
    const network = vi.fn(() => { throw new Error("No network in this test."); });vi.stubGlobal("fetch", network);
    const storage = createS3Storage(config);
    try {
      const url = new URL(await storage.signDownload("parent-documents", "owner/a,b.pdf", 30));
      expect(url.origin).toBe(config.projectUrl);
      expect(url.pathname).toBe("/storage/v1/s3/parent-documents/owner/a%2Cb.pdf");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("30");
      expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^synthetic-s3-access-id\//);
      expect(url.toString()).not.toContain(config.s3SecretAccessKey);
      await expect(storage.signDownload("parent-documents", "owner/a.pdf", 31)).rejects.toThrow("expiry");
      await expect(storage.signDownload("unapproved-bucket", "owner/a.pdf", 30)).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
    } finally { storage.destroy(); }
  });
  it("uploads exact bytes only through the fixed S3 command and reports unknown failures without private detail", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const storage = createS3Storage(config);
    try {
      await storage.upload("parent-form-artifacts", "owner/a.pdf", bytes, "application/pdf");
      const command = send.mock.calls[0][0];expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({ Bucket: "parent-form-artifacts", Key: "owner/a.pdf", Body: bytes, ContentType: "application/pdf" });
      expect(send.mock.calls[0][1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
      send.mockRejectedValueOnce(new Error("raw private provider response"));
      await expect(storage.upload("parent-form-artifacts", "owner/a.pdf", bytes, "application/pdf")).rejects.toThrow(/^upload_unconfirmed$/);
      expect(send).toHaveBeenCalledTimes(2);
      await expect(storage.upload("parent-documents", "owner/a.pdf", bytes, "application/pdf")).rejects.toThrow("purpose");
      await expect(storage.upload("parent-form-artifacts", "owner/a.pdf", bytes, "text/plain")).rejects.toThrow("purpose");
      expect(send).toHaveBeenCalledTimes(2);
    } finally { storage.destroy(); }
  });
  it("requires an actual Storage health acknowledgement and hides credential errors", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const storage = createS3Storage(config);
    try {
      expect(await storage.checkHealth!()).toBe(true);expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(send.mock.calls[0][0]).not.toBeInstanceOf(GetObjectCommand);
      send.mockRejectedValueOnce(new Error("private key failure"));expect(await storage.checkHealth!()).toBe(false);
    } finally { storage.destroy(); }
  });
  it.each([false, undefined, "true", 1])("does not treat malformed or absent database guard readiness as authorization", async ready => {
    expect(await storageArtifactGuardReady({ query: async () => ({ rows: [{ ready }] }) })).toBe(false);
  });
});

const deletionOwner = "11111111-1111-4111-8111-111111111111", deletionObject = "22222222-2222-4222-8222-222222222222";
it("deletes only exact ordinary document/artifact keys with one bounded S3 request", async () => {
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
  const timeout = vi.spyOn(AbortSignal, "timeout"); const storage = createS3Storage(config);
  try {
    for (const [bucket, path] of [["parent-documents", `${deletionOwner}/${deletionObject}/${deletionObject}`], ["parent-form-artifacts", `${deletionOwner}/${deletionObject}.pdf`]]) {
      await storage.remove(bucket, path, new AbortController().signal);
      const call = send.mock.calls.at(-1)!;
      expect(call[0]).toBeInstanceOf(DeleteObjectCommand); expect(call[0].input).toEqual({ Bucket: bucket, Key: path });
      expect(call[1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    }
    expect(send).toHaveBeenCalledTimes(2); expect(timeout).toHaveBeenCalledWith(15000);
    send.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_CANARY"));
    await expect(storage.remove("parent-form-artifacts", `${deletionOwner}/${deletionObject}.pdf`, new AbortController().signal)).rejects.toThrow(/^deletion_unconfirmed$/);
  } finally { storage.destroy(); }
});
it.each([
  ["school-documents", `${deletionOwner}/${deletionObject}/${deletionObject}`],
  ["parent-known-forms", `${deletionOwner}/${deletionObject}.pdf`],
  ["parent-documents", `${deletionOwner}/${deletionObject}.pdf`],
  ["parent-form-artifacts", `${deletionOwner}/${deletionObject}`],
  ["parent-documents", `${deletionOwner}/../${deletionObject}`],
  ["parent-form-artifacts", `${deletionOwner}/not-a-uuid.pdf`],
])("refuses deletion outside the exact ordinary object purposes %#", async (bucket, path) => {
  const send = vi.spyOn(S3Client.prototype, "send"), storage = createS3Storage(config);
  try { await expect(storage.remove(bucket, path, new AbortController().signal)).rejects.toThrow("purpose"); expect(send).not.toHaveBeenCalled(); }
  finally { storage.destroy(); }
});
it.each(["caller", "timeout"])("rejects late deletion acknowledgement after %s cancellation", async cause => {
  const controller = new AbortController(), timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  let resolve!: (value: unknown) => void;
  const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(() => new Promise(done => { resolve = done; }) as never);
  const storage = createS3Storage(config);
  try {
    const result = storage.remove("parent-form-artifacts", `${deletionOwner}/${deletionObject}.pdf`, controller.signal);
    (cause === "caller" ? controller : timeout).abort();
    expect((send.mock.calls[0][1] as { abortSignal: AbortSignal }).abortSignal.aborted).toBe(true);
    resolve({}); await expect(result).rejects.toThrow(/^deletion_unconfirmed$/);
  } finally { storage.destroy(); }
});
it("does not send a deletion when its authority was already cancelled", async () => {
  const send = vi.spyOn(S3Client.prototype, "send"), storage = createS3Storage(config), controller = new AbortController(); controller.abort();
  try { await expect(storage.remove("parent-form-artifacts", `${deletionOwner}/${deletionObject}.pdf`, controller.signal)).rejects.toThrow("unconfirmed"); expect(send).not.toHaveBeenCalled(); }
  finally { storage.destroy(); }
});

import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

import { describe, expect, it } from "vitest";
import { parentStorageDownloadAllowed } from "./storage-download";

const project = "http://127.0.0.1:55321", bucket = "parent-documents", path = "household/a,b.pdf";
describe("exact private Storage download destinations", () => {
  it.each(["s3", "object/sign"])("accepts the exact %s object on the approved project", prefix => {
    expect(parentStorageDownloadAllowed(`${project}/storage/v1/${prefix}/${bucket}/household/a%2Cb.pdf?signed=synthetic`, project, bucket, path)).toBe(true);
  });
  it.each([
    "https://other.example/storage/v1/s3/parent-documents/household/a%2Cb.pdf",
    `${project}/storage/v1/s3/parent-form-artifacts/household/a%2Cb.pdf`,
    `${project}/storage/v1/s3/parent-documents/household/other.pdf`,
    `${project}/storage/v1/s3/parent-documents/household/a%2Cb.pdf/extra`,
    `${project}/storage/v1/object/public/parent-documents/household/a%2Cb.pdf`,
    `${project}/storage/v1/s3/parent-documents/household/a%2Cb.pdf#fragment`,
    "http://secret@127.0.0.1:55321/storage/v1/s3/parent-documents/household/a%2Cb.pdf",
    `${project}/storage/v1/s3/parent-documents/household%2Fa%2Cb.pdf`,
    "not a URL",
  ])("rejects a different object or destination: %s", url => {
    expect(parentStorageDownloadAllowed(url, project, bucket, path)).toBe(false);
  });
});

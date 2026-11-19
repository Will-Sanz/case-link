import { MAX_DOCUMENT_BYTES } from "./constants";
/** Quarantine routing only. Full decoding/page validation belongs to the isolated worker. */
export function checkUploadHeader(
  bytes: Uint8Array,
  claimedType: string,
): "application/pdf" | "image/jpeg" | "image/png" {
  if (bytes.length < 12 || bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("unsupported_upload");
  const header = Buffer.from(bytes.subarray(0, 12));
  if (
    claimedType === "application/pdf" &&
    header.subarray(0, 5).toString() === "%PDF-"
  )
    return "application/pdf";
  if (
    claimedType === "image/png" &&
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    claimedType === "image/jpeg" &&
    header[0] === 255 &&
    header[1] === 216 &&
    header[2] === 255
  )
    return "image/jpeg";
  throw new Error("unsupported_upload");
}

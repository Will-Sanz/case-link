import { canonicalProjectOrigin } from "./project-origin";

/** A broker grant can name only this exact object on the already approved project. */
export function parentStorageDownloadAllowed(value: string, project: string, bucket: string, path: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== canonicalProjectOrigin(project) || url.username || url.password || url.hash) return false;
    const encoded = `${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return url.pathname === `/storage/v1/s3/${encoded}` || url.pathname === `/storage/v1/object/sign/${encoded}`;
  } catch { return false; }
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { snapFormSource } from "./snap-form-source";

/** Only a server-vetted source ID selects an asset; callers cannot supply a filename or source tuple. */
export function readSnapFormFile(templateId: unknown, options?: { signal?: AbortSignal }) {
  const form = snapFormSource(templateId);
  return readFile(join(process.cwd(), "data/verified-forms", form.language === "es" ? "snap-pa600fs-es-2019.pdf" : "snap-pa600fs-2019.pdf"), options);
}

import { z } from "zod";
import { snapApplicationSourceSchema } from "./snap-form-source";

const uuid = z.uuid().transform(value => value.toLowerCase());
const version = z.number().int().positive().max(2147483647);
export const snapCaptureScopeSchema = z.object({ expectedVersion: version, snapshotId: uuid }).strict();
export type SnapCaptureScope = z.infer<typeof snapCaptureScopeSchema>;
export const snapCaptureContextSchema = z.object({
  requestVersion: version, snapshotId: uuid, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: snapApplicationSourceSchema,
  applyingSubjectIds: z.array(uuid).min(1).max(30).refine(values => new Set(values).size === values.length),
}).strict();
export type SnapCaptureContext = z.infer<typeof snapCaptureContextSchema>;

const querySchema = snapCaptureScopeSchema.extend({ expectedVersion: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(version) });
export function snapCaptureQuery(url: URL): SnapCaptureScope {
  if (url.search.length > 256) throw new Error("parent_invalid_input");
  const values: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    if (!Object.hasOwn(querySchema.shape, name) || Object.hasOwn(values, name)) throw new Error("parent_invalid_input");
    values[name] = value;
  }
  return querySchema.parse(values);
}

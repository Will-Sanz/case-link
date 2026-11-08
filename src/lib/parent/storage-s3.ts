import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { canonicalProjectOrigin } from "./project-origin";
import { storagePurposeSchema, type StorageBrokerPorts } from "./storage-broker";
import type { WorkerDatabase } from "./worker-runtime";

const credential = z.string().min(8).max(256).regex(/^[A-Za-z0-9/+_=-]+$/).refine(value => !value.startsWith("sb_"));
export const s3StorageCredentialsSchema = z.object({
  s3AccessKeyId: credential,
  s3SecretAccessKey: credential.min(20),
  s3Region: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
}).strict();
const objectSchema = storagePurposeSchema.pick({ bucket: true, objectPath: true });
// Exact body and predicate of the reviewed immutable-artifact migration, not just its object names.
const guardBodySha256 = "de4956bbcafe4f1d51664ec829d66367beaadaccfdb3fa9925978df18153b5b2";
const guardDefinition = "CREATE TRIGGER parent_artifact_storage_immutable BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((old.bucket_id = 'parent-form-artifacts'::text) OR (new.bucket_id = 'parent-form-artifacts'::text))) EXECUTE FUNCTION parent_private.immutable_artifact_storage_object()".replaceAll(" ", "");

/** S3 always upserts; the separately tested database guard is required before every upload. */
export async function storageArtifactGuardReady(database: WorkerDatabase): Promise<boolean> {
  return (await database.query(`select current_user='parent_storage_broker' and exists(
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_namespace f on f.oid=p.pronamespace
    where n.nspname='storage' and c.relname='objects' and t.tgname='parent_artifact_storage_immutable'
    and t.tgenabled='O' and t.tgtype=19 and not t.tgisinternal and f.nspname='parent_private'
    and p.proname='immutable_artifact_storage_object' and p.pronargs=0 and not p.prosecdef
    and p.proconfig=array['search_path=""'] and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=$1
    and regexp_replace(pg_get_triggerdef(t.oid),'[[:space:]]','','g')=$2
    and not exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attname='path_tokens' and not a.attisdropped
        and (a.attgenerated<>'s' or pg_get_expr(d.adbin,d.adrelid) is distinct from $3))) ready`,
    [guardBodySha256,guardDefinition,"string_to_array(name, '/'::text)"])).rows[0]?.ready === true;
}

export function createS3Storage(input: { projectUrl: string } & z.infer<typeof s3StorageCredentialsSchema>):
  Required<Pick<StorageBrokerPorts, "signDownload" | "upload" | "checkHealth">> & { remove(bucket: string, path: string, signal: AbortSignal): Promise<void>; destroy(): void } {
  const project = canonicalProjectOrigin(input.projectUrl);
  if (!project) throw new Error("isolated_storage_origin_required");
  const credentials = s3StorageCredentialsSchema.parse({ s3AccessKeyId: input.s3AccessKeyId, s3SecretAccessKey: input.s3SecretAccessKey, s3Region: input.s3Region });
  const client = new S3Client({ endpoint: `${project}/storage/v1/s3`, forcePathStyle: true,
    region: credentials.s3Region, credentials: { accessKeyId: credentials.s3AccessKeyId, secretAccessKey: credentials.s3SecretAccessKey },
    maxAttempts: 1, followRegionRedirects: false, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  return {
    async checkHealth() {
      try { await client.send(new HeadBucketCommand({ Bucket: "parent-form-artifacts" }), { abortSignal: AbortSignal.timeout(15000) }); return true; }
      catch { return false; }
    },
    async signDownload(bucket, path, seconds) {
      objectSchema.parse({ bucket, objectPath: path });
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new Error("download_expiry_unavailable");
      try { return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), { expiresIn: seconds }); }
      catch { throw new Error("download_unavailable"); }
    },
    async upload(bucket, path, bytes, mediaType) {
      objectSchema.parse({ bucket, objectPath: path });
      if (bucket !== "parent-form-artifacts" || mediaType !== "application/pdf" || !bytes.length || bytes.length > 10485760)
        throw new Error("upload_purpose_unavailable");
      try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: path, Body: bytes, ContentType: mediaType }), { abortSignal: AbortSignal.timeout(15000) }); }
      catch { throw new Error("upload_unconfirmed"); }
    },
    async remove(bucket, path, signal) {
      const parts = path.replace(/\.pdf$/, "").split("/");
      if (!((bucket === "parent-documents" && parts.length === 3 && !path.endsWith(".pdf"))
        || (bucket === "parent-form-artifacts" && parts.length === 2 && path.endsWith(".pdf")))
        || parts.some(part => !z.uuid().safeParse(part).success)) throw new Error("deletion_purpose_unavailable");
      try {
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        bounded.throwIfAborted();
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }), { abortSignal: bounded });
        bounded.throwIfAborted();
      } catch { throw new Error("deletion_unconfirmed"); }
    },
    destroy: () => client.destroy(),
  };
}

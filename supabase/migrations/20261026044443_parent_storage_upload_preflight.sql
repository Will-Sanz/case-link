-- Storage checks INSERT before it has final byte metadata; confirmation gates all reads and processing.
alter policy parent_document_storage_insert on storage.objects
with check (
  bucket_id='parent-documents' and exists (
    select 1 from public.parent_documents d
    join public.parent_requests r on r.id=d.request_id
    where d.object_path=name and d.status='uploaded' and d.upload_confirmed_at is null
      and d.expires_at>now() and r.status in ('active','paused')
      and (metadata is null or not (metadata ? 'size') or (metadata->>'size')::bigint=d.size_bytes)
      and (metadata is null or not (metadata ? 'mimetype') or metadata->>'mimetype'=d.media_type)
      and parent_private.owns_request(d.request_id)
  )
);

alter policy parent_document_storage_read on storage.objects
using (
  bucket_id='parent-documents' and exists (
    select 1 from public.parent_documents d
    where d.object_path=name and d.upload_confirmed_at is not null
      and d.status not in ('deleted','deletion_pending') and d.expires_at>now()
      and parent_private.owns_request(d.request_id)
  )
);

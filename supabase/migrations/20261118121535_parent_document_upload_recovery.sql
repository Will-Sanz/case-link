-- One owned upload attempt keeps its original consent, HTTP body identity and expiry across uncertain acknowledgements.
-- upload_sha256 is request identity; legacy Storage confirmation remains metadata-based, not a stored-content digest.
alter table public.parent_documents
  add column upload_key uuid,
  add column upload_sha256 text,
  add constraint parent_document_upload_binding check (
    (upload_key is null and upload_sha256 is null) or
    (upload_key is not null and upload_sha256 is not null and upload_sha256 ~ '^[0-9a-f]{64}$')
  );
create unique index parent_document_upload_attempt on public.parent_documents(request_id,upload_key) where upload_key is not null;

create function parent_private.immutable_document_upload_binding() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.upload_key is not null and (
    (new.upload_key,new.upload_sha256,new.request_id,new.filename,new.media_type,new.size_bytes,new.object_path,new.consent_version,new.consented_at,new.created_at)
      is distinct from
    (old.upload_key,old.upload_sha256,old.request_id,old.filename,old.media_type,old.size_bytes,old.object_path,old.consent_version,old.consented_at,old.created_at)
    or new.expires_at>old.expires_at) then
    raise exception 'document upload binding is immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function parent_private.immutable_document_upload_binding() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
create trigger parent_document_upload_binding before update on public.parent_documents
  for each row execute function parent_private.immutable_document_upload_binding();

-- The existing six-argument RPC stays unchanged for legacy callers. Required extra arguments select this overload.
create function public.parent_register_document(p_request_id uuid,p_filename text,p_media_type text,p_size_bytes integer,p_page_count integer,p_consent_version text,p_upload_key uuid,p_upload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; document public.parent_documents;
begin
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  if p_upload_key is null or p_upload_sha256 is null or p_upload_sha256!~'^[0-9a-f]{64}$' or p_page_count is not null then
    raise exception 'invalid document upload attempt' using errcode='23514';
  end if;
  select * into request from public.parent_requests where id=p_request_id for update;
  if not parent_private.owns_request(p_request_id) then raise exception 'request unavailable' using errcode='42501'; end if;
  select * into document from public.parent_documents where request_id=p_request_id and upload_key=p_upload_key;
  if not found then
    -- Legacy product uploads had no nonce. Only their exact owned document id may become the immutable attempt key.
    select * into document from public.parent_documents where request_id=p_request_id and id=p_upload_key and upload_key is null;
  end if;
  if found then
    if (document.filename,document.media_type,document.size_bytes,document.consent_version)
      is distinct from (p_filename,p_media_type,p_size_bytes,p_consent_version)
      or (document.upload_key is not null and document.upload_sha256 is distinct from p_upload_sha256) then
      raise exception 'document upload attempt changed' using errcode='PT409';
    end if;
    -- An already confirmed receipt is an owned read. It cannot register bytes, refresh consent or resume work.
    if document.upload_key is null and (document.upload_confirmed_at is not null or document.status<>'uploaded' or document.expires_at<=now()) then
      raise exception 'legacy document upload unavailable' using errcode='42501';
    end if;
    if document.upload_confirmed_at is not null then
      return jsonb_build_object('document',to_jsonb(document),'existing',true);
    end if;
    if request.status not in ('active','paused') then raise exception 'request unavailable' using errcode='42501'; end if;
    if request.intake->'needs' <@ '["wic_new","wic_continuing"]'::jsonb
      or exists(select 1 from public.parent_peco_application_details where request_id=p_request_id)
      or exists(select 1 from public.parent_pgw_application_details where request_id=p_request_id)
      or exists(select 1 from public.parent_water_application_details where request_id=p_request_id) then
      raise exception 'private documents require their supported route' using errcode='42501';
    end if;
    if document.upload_key is null then
      update public.parent_documents set upload_key=p_upload_key,upload_sha256=p_upload_sha256 where id=document.id returning * into document;
    end if;
    return jsonb_build_object('document',to_jsonb(document),'existing',true);
  end if;
  select * into document from public.parent_register_document(p_request_id,p_filename,p_media_type,p_size_bytes,p_page_count,p_consent_version);
  update public.parent_documents set upload_key=p_upload_key,upload_sha256=p_upload_sha256 where id=document.id returning * into document;
  return jsonb_build_object('document',to_jsonb(document),'existing',false);
end $$;
revoke all on function public.parent_register_document(uuid,text,text,integer,integer,text,uuid,text)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_register_document(uuid,text,text,integer,integer,text,uuid,text) to authenticated;
notify pgrst,'reload schema';

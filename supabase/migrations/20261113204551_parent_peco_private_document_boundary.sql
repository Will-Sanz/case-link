-- Extend the existing closed-document boundary to private PECO preparation.
-- A revision is a durable purpose marker; source expiry or a later mandate does
-- not turn on the unreviewed document/parser channel. Separate upload consent
-- continues to work for ordinary requests without this private purpose.
create or replace function parent_private.reject_wic_only_document_capture() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.parent_requests where id=new.request_id for update;
  if exists(select 1 from public.parent_requests r where r.id=new.request_id
    and r.intake->'needs' <@ '["wic_new","wic_continuing"]'::jsonb) then
    raise exception 'WIC document processing is unavailable' using errcode='42501';
  end if;
  if exists(select 1 from public.parent_peco_application_details p where p.request_id=new.request_id) then
    raise exception 'PECO private document processing is unavailable' using errcode='42501';
  end if;
  return new;
end $$;

alter policy parent_wic_document_storage_closed on storage.objects with check (
  bucket_id<>'parent-documents' or not exists(
    select 1 from public.parent_documents d join public.parent_requests r on r.id=d.request_id
    where d.object_path=name and (r.intake->'needs' <@ '["wic_new","wic_continuing"]'::jsonb
      or exists(select 1 from public.parent_peco_application_details p where p.request_id=r.id))
  )
);

create or replace function parent_private.parent_authorize_storage(p_job_id uuid,p_lease_token uuid,p_bucket text,p_object_path text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job public.parent_jobs;
begin
  select * into v_job from public.parent_jobs where id=p_job_id;
  v_job:=parent_private.require_lease(p_job_id,p_lease_token,v_job.request_version);
  if p_bucket='parent-documents' then
    if exists(select 1 from public.parent_requests r where r.id=v_job.request_id
      and r.intake->'needs' <@ '["wic_new","wic_continuing"]'::jsonb) then
      raise exception 'WIC document processing is unavailable' using errcode='42501';
    end if;
    if exists(select 1 from public.parent_peco_application_details p where p.request_id=v_job.request_id) then
      raise exception 'PECO private document processing is unavailable' using errcode='42501';
    end if;
  end if;
  return parent_private.authorize_storage_before_wic_documents(p_job_id,p_lease_token,p_bucket,p_object_path,p_mode);
end $$;
revoke execute on function parent_private.reject_wic_only_document_capture(),parent_private.authorize_storage_before_wic_documents(uuid,uuid,text,text,text),parent_private.parent_authorize_storage(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker;
grant execute on function parent_private.parent_authorize_storage(uuid,uuid,text,text,text) to parent_storage_broker;

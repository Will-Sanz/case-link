-- S3 writes distinct physical versions; reject replacing the published immutable artifact pointer.
do $guard$
begin
  if exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='storage.objects'::regclass and a.attname='path_tokens' and not a.attisdropped
      and (a.attgenerated<>'s' or pg_get_expr(d.adbin,d.adrelid) is distinct from 'string_to_array(name, ''/''::text)')) then
    raise exception 'unsupported generated Storage path column' using errcode='23514';
  end if;
end $guard$;
create function parent_private.immutable_artifact_storage_object() returns trigger
language plpgsql set search_path='' as $$
begin
  -- path_tokens is derived from name after BEFORE triggers; preserve every independent field.
  if (to_jsonb(new)-array['updated_at','last_accessed_at','path_tokens']) is distinct from
     (to_jsonb(old)-array['updated_at','last_accessed_at','path_tokens']) then
    raise exception 'stored application artifacts are immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function parent_private.immutable_artifact_storage_object()
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_retention_worker;
create trigger parent_artifact_storage_immutable before update on storage.objects for each row
  when (old.bucket_id='parent-form-artifacts' or new.bucket_id='parent-form-artifacts')
  execute function parent_private.immutable_artifact_storage_object();

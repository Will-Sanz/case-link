-- Source dates are metadata for existing intake, not new family information.
alter table public.parent_requests add column intake_confirmed_at jsonb not null default '{}'
  check(jsonb_typeof(intake_confirmed_at)='object');

-- Old edits/renewals do not establish when each original value was supplied.
update public.parent_requests r set intake_confirmed_at=(
  select jsonb_object_agg(k,to_jsonb(r.created_at)) from jsonb_object_keys(r.intake) k
);

create function parent_private.record_intake_source_dates() returns trigger
language plpgsql set search_path='' as $$
declare v_field text;
begin
  if tg_op='INSERT' then
    select jsonb_object_agg(k,to_jsonb(now())) into new.intake_confirmed_at from jsonb_object_keys(new.intake) k;
  else
    new.intake_confirmed_at:=old.intake_confirmed_at;
    for v_field in select jsonb_object_keys(new.intake) loop
      if new.intake->v_field is distinct from old.intake->v_field then
        new.intake_confirmed_at:=jsonb_set(new.intake_confirmed_at,array[v_field],to_jsonb(now()));
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger parent_intake_source_dates before insert or update of intake on public.parent_requests
  for each row execute function parent_private.record_intake_source_dates();
revoke execute on function parent_private.record_intake_source_dates()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;

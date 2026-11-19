-- Keep incomplete-draft authority enforced even outside the worker registration RPC.
create or replace function parent_private.bind_form_preparation_scope() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    select t.preparation_only into new.preparation_only from parent_private.form_templates t
      where t.id=new.template_id and t.version=new.template_version;
    if new.preparation_only is null then raise exception 'verified template required' using errcode='42501'; end if;
    if new.preparation_only and not exists(
      select 1 from public.parent_requests r where r.id=new.request_id and r.mandate->'allowedActions' ? 'prepare'
    ) then raise exception 'preparation is outside the current mandate' using errcode='42501'; end if;
  elsif new.preparation_only is distinct from old.preparation_only then
    raise exception 'form preparation scope is immutable' using errcode='23514';
  end if;
  return new;
end $$;

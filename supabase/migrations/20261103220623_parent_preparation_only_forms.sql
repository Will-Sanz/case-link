-- An incomplete preparation draft can never become an executable application artifact.
alter table parent_private.form_templates add column preparation_only boolean not null default false;
alter table public.parent_form_artifacts add column preparation_only boolean not null default false;

create function parent_private.bind_form_preparation_scope() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    select t.preparation_only into new.preparation_only from parent_private.form_templates t
      where t.id=new.template_id and t.version=new.template_version;
    if new.preparation_only is null then raise exception 'verified template required' using errcode='42501'; end if;
  elsif new.preparation_only is distinct from old.preparation_only then
    raise exception 'form preparation scope is immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke execute on function parent_private.bind_form_preparation_scope() from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
create trigger parent_form_preparation_scope before insert or update on public.parent_form_artifacts
  for each row execute function parent_private.bind_form_preparation_scope();

create or replace function parent_private.validate_form_artifact(p_request_id uuid,p_version integer,p_need text,p_program text,p_action text,p_packet jsonb,p_artifact uuid) returns void
language plpgsql set search_path='' as $$
declare v_artifact public.parent_form_artifacts; v_requires boolean;
begin
  select requires_form into v_requires from parent_private.provider_capabilities where program_id=p_program and action=p_action;
  if p_artifact is null then
    if v_requires then raise exception 'a verified form artifact is required' using errcode='42501'; end if;
    return;
  end if;
  select * into v_artifact from public.parent_form_artifacts where id=p_artifact;
  if p_action not in ('research','prepare') and (v_artifact.preparation_only or exists(
    select 1 from parent_private.form_templates t where t.id=v_artifact.template_id
      and t.version=v_artifact.template_version and t.preparation_only
  )) then raise exception 'an incomplete preparation draft cannot be sent' using errcode='42501'; end if;
  if exists(select 1 from parent_private.form_templates t join parent_private.provider_capabilities c on c.program_id=p_program and c.action=p_action where t.id=v_artifact.template_id and t.version=v_artifact.template_version and not t.required_acts<@c.required_acts) then raise exception 'form personal requirements do not match the verified execution contract' using errcode='42501'; end if;
  if not found or v_artifact.request_id<>p_request_id or v_artifact.request_version<>p_version or v_artifact.need<>p_need or v_artifact.program_id<>p_program or v_artifact.status<>'stored' or v_artifact.expires_at<=now()
    or v_artifact.form_input_digest<>encode(sha256(convert_to(p_packet::text,'UTF8')),'hex')
    or not exists(select 1 from parent_private.form_templates t where t.id=v_artifact.template_id and t.version=v_artifact.template_version and t.content_sha256=v_artifact.template_hash and t.active and t.verified_until>now()) then raise exception 'form artifact no longer matches the exact operation' using errcode='42501'; end if;
end $$;

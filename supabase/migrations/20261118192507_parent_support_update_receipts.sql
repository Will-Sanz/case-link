-- Exact acknowledgements for four existing parent edits; no new authority or raw answer copy.
create table public.parent_support_update_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.parent_requests(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check(action in ('replace_mandate','answer_fact','answer_facts','booking_preference')),
  base_version integer not null check(base_version>0),
  result_version integer not null check(result_version>base_version),
  payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(request_id,idempotency_key)
);
alter table public.parent_support_update_receipts enable row level security;
revoke all on public.parent_support_update_receipts from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant select on public.parent_support_update_receipts to authenticated;
create policy parent_support_update_read on public.parent_support_update_receipts for select to authenticated
  using(parent_private.owns_request(request_id));

create function public.parent_apply_support_update(p_request_id uuid,p_idempotency_key uuid,p_update jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request public.parent_requests; receipt public.parent_support_update_receipts;
  operation_hash text; base integer; operation text;
begin
  if not public.is_parent_session() then raise exception 'support update unavailable' using errcode='42501'; end if;
  -- Account before request matches deletion/offboarding lock order and keeps current membership stable.
  perform 1 from public.parent_accounts where id=auth.uid() and status='active' for share;
  if not found or not parent_private.owns_request(p_request_id) then raise exception 'support update unavailable' using errcode='42501'; end if;
  select * into request from public.parent_requests where id=p_request_id for update;
  if not found then raise exception 'support update unavailable' using errcode='42501'; end if;
  if p_idempotency_key is null or p_update is null or jsonb_typeof(p_update) is distinct from 'object' or pg_column_size(p_update)>40000
    then raise exception 'invalid support update' using errcode='23514'; end if;
  operation_hash:=encode(sha256(convert_to(jsonb_build_array(p_request_id,p_idempotency_key,p_update)::text,'UTF8')),'hex');
  select * into receipt from public.parent_support_update_receipts where request_id=p_request_id and idempotency_key=p_idempotency_key;
  if found then
    if receipt.payload_hash is distinct from operation_hash then raise exception 'support update key changed' using errcode='PT409'; end if;
  else
    operation:=p_update->>'action';
    if not(p_update ?& array['action','version']) or jsonb_typeof(p_update->'action') is distinct from 'string'
      or jsonb_typeof(p_update->'version') is distinct from 'number' or coalesce(p_update->>'version','')!~'^[1-9][0-9]{0,9}$'
      or (p_update->>'version')::numeric>2147483647 then raise exception 'invalid support update' using errcode='23514'; end if;
    base:=(p_update->>'version')::integer;
    if operation='replace_mandate' then
      if p_update-array['action','version','mandate']<>'{}' or not(p_update ? 'mandate') then raise exception 'invalid permission update' using errcode='23514'; end if;
      perform public.parent_replace_mandate(p_request_id,p_update->'mandate',base);
    elsif operation='answer_fact' then
      if p_update-array['action','version','need','field','value']<>'{}' or not(p_update ?& array['need','field','value'])
        or jsonb_typeof(p_update->'need') is distinct from 'string' or jsonb_typeof(p_update->'field') is distinct from 'string'
        then raise exception 'invalid factual update' using errcode='23514'; end if;
      perform public.parent_answer_fact(p_request_id,p_update->>'need',p_update->>'field',p_update->'value',base);
    elsif operation='answer_facts' then
      if p_update-array['action','version','answers']<>'{}' or not(p_update ? 'answers') then raise exception 'invalid factual update' using errcode='23514'; end if;
      perform public.parent_answer_facts(p_request_id,p_update->'answers',base);
    elsif operation='booking_preference' then
      if p_update-array['action','version','preference']<>'{}' or jsonb_typeof(p_update->'preference') is distinct from 'string'
        then raise exception 'invalid booking update' using errcode='23514'; end if;
      perform public.parent_update_booking_preference(p_request_id,p_update->>'preference',base);
    else raise exception 'unsupported support update' using errcode='23514'; end if;
    insert into public.parent_support_update_receipts(request_id,idempotency_key,action,base_version,result_version,payload_hash)
      select p_request_id,p_idempotency_key,operation,base,version,operation_hash from public.parent_requests where id=p_request_id
      returning * into receipt;
  end if;
  return jsonb_build_object('id',receipt.id,'key',receipt.idempotency_key,'requestId',receipt.request_id,'action',receipt.action,
    'baseVersion',receipt.base_version,'resultVersion',receipt.result_version,'recordedAt',receipt.created_at);
end $$;
revoke all on function public.parent_apply_support_update(uuid,uuid,jsonb) from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer,parent_utility_protected;
grant execute on function public.parent_apply_support_update(uuid,uuid,jsonb) to authenticated;

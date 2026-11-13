-- Reuse ordinary routing only. Private application answers keep their named purpose.
alter table public.parent_requests add column intake_reuse jsonb not null default '{}'
  check (jsonb_typeof(intake_reuse)='object' and pg_column_size(intake_reuse)<2000);

-- Serialize household starts without blocking unchanged household foreign-key checks during propagation.
create or replace function public.parent_start_request(p_intake jsonb,p_mandate jsonb,p_idempotency_key uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_household uuid; v_request uuid; v_existing public.parent_requests;
begin
  v_household:=public.parent_ensure_account();
  perform parent_private.validate_intake(p_intake); perform parent_private.validate_mandate(p_mandate);
  perform 1 from public.parent_households where id=v_household for no key update;
  if p_idempotency_key is not null then
    select * into v_existing from public.parent_requests where household_id=v_household and start_key=p_idempotency_key;
    if found then
      if v_existing.intake<>p_intake or v_existing.mandate<>p_mandate then raise exception 'start key already binds another request' using errcode='23514'; end if;
      return v_existing.id;
    end if;
  end if;
  if (select count(*) from public.parent_requests where household_id=v_household and status in ('active','paused'))>=12 then raise exception 'active request limit reached' using errcode='23514'; end if;
  if p_intake->>'contactPreference'='email' then update public.parent_accounts set preferences=jsonb_set(preferences,'{contactPreference}','"email"') where id=auth.uid(); end if;
  insert into public.parent_requests(household_id,start_key,intake,mandate) values(v_household,coalesce(p_idempotency_key,gen_random_uuid()),p_intake,p_mandate) returning id into v_request;
  insert into public.parent_jobs(request_id,request_version) values(v_request,1);
  insert into public.parent_events(request_id,kind,actor,summary,evidence) values(v_request,'request.started','parent','You asked CaseLink to start getting support.',jsonb_build_object('mandateVersion',1,'expiresAt',p_mandate->>'expiresAt'));
  return v_request;
end $$;

create function parent_private.reusable_zip_source(p_source uuid,p_household uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare r public.parent_requests; confirmed timestamptz; expires timestamptz;
begin
  select * into r from public.parent_requests where id=p_source and household_id=p_household;
  if not found or not((r.status in ('active','paused') and r.mandate_revoked_at is null)
    or (r.status='closed' and coalesce(r.closed_reason in ('completed','all_permitted_routes_exhausted','provider_declined','out_of_area'),false)))
    or not(r.mandate->'allowedData' ? 'household') or r.intake_reuse ? 'zip'
    or 'zip'=any(r.intake_need_scoped_fields) or coalesce(r.intake->>'zip','')!~'^[0-9]{5}$'
    or not exists(select 1 from public.parent_households h join public.parent_accounts a on a.id=h.owner_id
      where h.id=p_household and a.status='active') then return null; end if;
  confirmed:=parent_private.fixed_source_timestamp(r.intake_confirmed_at->>'zip');
  -- The new mandate authorizes use; ending the old workflow does not renew or withdraw its ordinary fact.
  expires:=least(confirmed+interval '1080 hours',case when r.status='closed' then r.updated_at+interval '90 days' else confirmed+interval '1080 hours' end);
  if confirmed is null or confirmed>now() or expires<=now() then return null; end if;
  return jsonb_build_object('sourceRequestId',r.id,'sourceVersion',r.version,'value',r.intake->'zip',
    'confirmedAt',confirmed,'expiresAt',expires);
end $$;

create function parent_private.household_reusable_zip(p_household uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb; distinct_values integer;
begin
  select count(distinct candidate->>'value') into distinct_values from public.parent_requests r
    cross join lateral (select parent_private.reusable_zip_source(r.id,p_household) candidate) c
    where r.household_id=p_household and candidate is not null;
  if distinct_values<>1 then return null; end if;
  select candidate into result from public.parent_requests r
    cross join lateral (select parent_private.reusable_zip_source(r.id,p_household) candidate) c
    where r.household_id=p_household and candidate is not null
    order by (candidate->>'confirmedAt')::timestamptz desc,r.id limit 1;
  return result;
end $$;
create function public.parent_reusable_zip() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_parent_session() then raise exception 'parent unavailable' using errcode='42501'; end if;
  return parent_private.household_reusable_zip((select id from public.parent_households where owner_id=auth.uid()));
end $$;

create function public.parent_start_request_with_reused_zip(p_intake jsonb,p_mandate jsonb,p_idempotency_key uuid,p_source_request_id uuid,p_source_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare household uuid; candidate jsonb; existing public.parent_requests; request_id uuid;
  start_hash text:=encode(sha256(convert_to(jsonb_build_array(p_intake,p_mandate,p_source_request_id,p_source_version)::text,'UTF8')),'hex');
begin
  household:=public.parent_ensure_account();
  perform 1 from public.parent_households where id=household for no key update;
  if p_idempotency_key is null then raise exception 'start key required' using errcode='23514'; end if;
  select * into existing from public.parent_requests where household_id=household and start_key=p_idempotency_key for update;
  if found then
    if existing.intake_reuse#>>'{zip,startHash}' is distinct from start_hash then
      raise exception 'start key changed' using errcode='40001'; end if;
    return existing.id;
  end if;
  perform parent_private.validate_intake(p_intake); perform parent_private.validate_mandate(p_mandate);
  begin
    -- A correction already holding the source wins before any request is created.
    perform 1 from public.parent_requests where id=p_source_request_id and household_id=household for update nowait;
  exception when lock_not_available then
    raise exception 'parent_reuse_source_changed' using errcode='P0001';
  end;
  candidate:=public.parent_reusable_zip();
  if candidate is null or candidate->>'sourceRequestId' is distinct from p_source_request_id::text
    or (candidate->>'sourceVersion')::integer is distinct from p_source_version
    or candidate->'value' is distinct from p_intake->'zip' or not(p_mandate->'allowedData' ? 'household') then
    raise exception 'parent_reuse_source_changed' using errcode='P0001'; end if;
  request_id:=public.parent_start_request(p_intake,p_mandate,p_idempotency_key);
  update public.parent_requests set intake_reuse=jsonb_build_object('zip',(candidate-'value')||jsonb_build_object('startHash',start_hash)),
    intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}',candidate->'confirmedAt') where id=request_id;
  return request_id;
end $$;

create or replace function parent_private.record_intake_source_dates() returns trigger
language plpgsql set search_path='' as $$
declare field text;
begin
  if tg_op='INSERT' then
    select jsonb_object_agg(k,to_jsonb(now())) into new.intake_confirmed_at from jsonb_object_keys(new.intake) k;
    new.intake_need_scoped_fields:='{}';
  else
    new.intake_confirmed_at:=old.intake_confirmed_at;
    new.intake_need_scoped_fields:=old.intake_need_scoped_fields;
    for field in select jsonb_object_keys(new.intake) loop
      if new.intake->field is distinct from old.intake->field then
        new.intake_confirmed_at:=jsonb_set(new.intake_confirmed_at,array[field],to_jsonb(now()));
        new.intake_need_scoped_fields:=array_remove(new.intake_need_scoped_fields,field);
        if field='zip' and new.intake_reuse is not distinct from old.intake_reuse then
          new.intake_reuse:=new.intake_reuse-'zip';
        end if;
      end if;
    end loop;
    if new.intake_reuse ? 'zip' then
      new.intake_confirmed_at:=jsonb_set(new.intake_confirmed_at,'{zip}',new.intake_reuse#>'{zip,confirmedAt}');
    end if;
  end if;
  return new;
end $$;
drop trigger parent_intake_source_dates on public.parent_requests;
create trigger parent_intake_source_dates before insert or update of intake,intake_reuse on public.parent_requests
  for each row execute function parent_private.record_intake_source_dates();

alter function parent_private.current_intake_fields(uuid,text) rename to original_current_intake_fields;
create function parent_private.current_intake_fields(p_request_id uuid,p_need text) returns jsonb
language plpgsql stable set search_path='' as $$
declare r public.parent_requests; result jsonb; candidate jsonb;
begin
  result:=parent_private.original_current_intake_fields(p_request_id,p_need);
  select * into r from public.parent_requests where id=p_request_id;
  if r.intake_reuse ? 'zip' then
    candidate:=parent_private.reusable_zip_source((r.intake_reuse#>>'{zip,sourceRequestId}')::uuid,r.household_id);
    if candidate is null or parent_private.household_reusable_zip(r.household_id) is null
      or coalesce((r.intake_reuse#>>'{zip,invalidated}')::boolean,false)
      or candidate->'value' is distinct from r.intake->'zip'
      or candidate->'confirmedAt' is distinct from r.intake_reuse#>'{zip,confirmedAt}'
      or (r.intake_reuse#>>'{zip,expiresAt}')::timestamptz<=now()
      or (candidate->>'expiresAt')::timestamptz<(r.intake_reuse#>>'{zip,expiresAt}')::timestamptz then
      -- A newly supplied exact-need answer is independent of the borrowed generic value.
      if not exists(select 1 from jsonb_array_elements(r.facts) f
        where f->>'need'=p_need and f->>'field'='zip' and f->>'source'='parent'
          and jsonb_typeof(f->'value')='string' and f->'value'=result->'zip'
          and parent_private.fixed_source_timestamp(f->>'confirmedAt') between now()-interval '1080 hours' and now()
          and parent_private.fixed_source_timestamp(f->>'asOf') between now()-interval '1080 hours'
            and parent_private.fixed_source_timestamp(f->>'confirmedAt')) then
        result:=result-'zip';
      end if;
    end if;
  end if;
  return result;
end $$;

create function parent_private.refresh_reused_zip(p_target uuid,p_candidate jsonb) returns void
language plpgsql set search_path='' as $$
declare r public.parent_requests; metadata jsonb;
begin
  select * into r from public.parent_requests where id=p_target for update;
  if not found or not(r.intake_reuse ? 'zip') then return; end if;
  if not(r.mandate->'allowedData' ? 'household') then p_candidate:=null; end if;
  if p_candidate is not null and p_candidate->'confirmedAt'=r.intake_reuse#>'{zip,confirmedAt}' then
    p_candidate:=jsonb_set(p_candidate,'{expiresAt}',to_jsonb(least(
      (p_candidate->>'expiresAt')::timestamptz,(r.intake_reuse#>>'{zip,expiresAt}')::timestamptz)));
    p_candidate:=jsonb_set(p_candidate,'{sourceVersion}',r.intake_reuse#>'{zip,sourceVersion}');
  end if;
  metadata:=case when p_candidate is null then r.intake_reuse->'zip'||'{"invalidated":true}'::jsonb
    else (p_candidate-'value')||jsonb_build_object('startHash',r.intake_reuse#>'{zip,startHash}') end;
  if r.intake->'zip' is not distinct from coalesce(p_candidate->'value','null'::jsonb)
    and r.intake_reuse->'zip' is not distinct from metadata then return; end if;
  -- Future work changes; immutable attempted packets retain their separate history/retention.
  if r.status in ('active','paused') then
    perform parent_private.requeue_parent_change(p_target,'Saved routing information changed. CaseLink stopped superseded work and will check the current information.');
  else
    perform parent_private.invalidate_work(p_target,'Saved routing information is no longer current.');
  end if;
  update public.parent_requests set intake=jsonb_set(intake,'{zip}',coalesce(p_candidate->'value','null'::jsonb)),
    intake_reuse=jsonb_set(intake_reuse,'{zip}',metadata),plan=null,required_actions='[]'
    where id=p_target;
end $$;

create function parent_private.propagate_reused_zip() returns trigger
language plpgsql security definer set search_path='' as $$
declare target public.parent_requests; candidate jsonb; household uuid;
begin
  if tg_op='DELETE' then
    if old.intake_reuse ? 'zip' then return null; end if;
    household:=old.household_id;
  else
    if new.intake_reuse ? 'zip' then return null; end if;
    household:=new.household_id;
  end if;
  if tg_op='UPDATE' and new.intake->'zip' is not distinct from old.intake->'zip'
    and new.intake_confirmed_at->'zip' is not distinct from old.intake_confirmed_at->'zip'
    and new.intake_need_scoped_fields is not distinct from old.intake_need_scoped_fields
    and new.mandate is not distinct from old.mandate and new.mandate_revoked_at is not distinct from old.mandate_revoked_at
    and new.closed_reason is not distinct from old.closed_reason
    and new.status is not distinct from old.status then return null; end if;
  for target in select r.* from public.parent_requests r
    where r.household_id=household and r.intake_reuse ? 'zip' order by r.id for update loop
    candidate:=null;
    if parent_private.household_reusable_zip(household) is not null then
      candidate:=parent_private.reusable_zip_source((target.intake_reuse#>>'{zip,sourceRequestId}')::uuid,household);
    end if;
    perform parent_private.refresh_reused_zip(target.id,candidate);
  end loop;
  return null;
end $$;
create trigger parent_reused_zip_change after insert or update or delete on public.parent_requests
  for each row execute function parent_private.propagate_reused_zip();

create function parent_private.scrub_expired_reused_zip(p_limit integer) returns void
language plpgsql set search_path='' as $$
declare target uuid;
begin
  for target in select r.id from public.parent_requests r where r.intake_reuse ? 'zip'
    and r.intake->'zip'<>'null'::jsonb and (
      coalesce((r.intake_reuse#>>'{zip,invalidated}')::boolean,false)
      or (r.intake_reuse#>>'{zip,expiresAt}')::timestamptz<=now()) order by r.id for update skip locked limit p_limit loop
    perform parent_private.refresh_reused_zip(target,null);
  end loop;
end $$;
alter function parent_private.parent_claim_cleanup(integer) rename to original_parent_claim_cleanup;
create function parent_private.parent_claim_cleanup(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup batch limit' using errcode='23514'; end if;
  perform parent_private.scrub_expired_reused_zip(p_limit);
  return parent_private.original_parent_claim_cleanup(p_limit);
end $$;

revoke execute on function parent_private.reusable_zip_source(uuid,uuid),parent_private.household_reusable_zip(uuid),parent_private.original_current_intake_fields(uuid,text),
  parent_private.current_intake_fields(uuid,text),parent_private.refresh_reused_zip(uuid,jsonb),parent_private.propagate_reused_zip(),
  parent_private.scrub_expired_reused_zip(integer),parent_private.original_parent_claim_cleanup(integer)
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;
revoke execute on function public.parent_reusable_zip(),public.parent_start_request_with_reused_zip(jsonb,jsonb,uuid,uuid,integer)
  from public,anon,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;
grant execute on function public.parent_reusable_zip(),public.parent_start_request_with_reused_zip(jsonb,jsonb,uuid,uuid,integer) to authenticated;
revoke execute on function parent_private.parent_claim_cleanup(integer)
  from public,anon,authenticated,service_role,parent_worker,parent_storage_broker,parent_snap_finalizer;
grant execute on function parent_private.parent_claim_cleanup(integer) to parent_retention_worker;

-- The assistant's explicit request projection must carry the same expiry as the worker/API.
alter function parent_private.parent_claim_assistant() rename to original_parent_claim_assistant;
create function parent_private.parent_claim_assistant() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=parent_private.original_parent_claim_assistant();
  if result is null then return null; end if;
  return jsonb_set(result,'{request,intake_reuse}',coalesce((select intake_reuse from public.parent_requests
    where id=(result#>>'{request,id}')::uuid),'{}'::jsonb));
end $$;
revoke execute on function parent_private.original_parent_claim_assistant(),parent_private.parent_claim_assistant()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker,parent_snap_finalizer;
grant execute on function parent_private.parent_claim_assistant() to parent_worker;

-- Run only on the dedicated, empty synthetic staging project. Always rolls back.
begin;
do $$
declare
  staff uuid := gen_random_uuid();
  other_staff uuid := gen_random_uuid();
  session uuid := gen_random_uuid();
  own_case uuid := gen_random_uuid();
  other_case uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.families) then
    raise exception 'This smoke test requires an empty synthetic project';
  end if;
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  values (staff,'authenticated','authenticated',staff||'@example.test',now(),now()),
         (other_staff,'authenticated','authenticated',other_staff||'@example.test',now(),now());
  insert into auth.sessions (id,user_id) values (session,staff);
  insert into public.app_users (id,email,role)
  values (staff,staff||'@example.test','case_manager'),(other_staff,other_staff||'@example.test','case_manager');
  insert into public.families (id,name,created_by_id)
  values (own_case,'Synthetic own family',staff),(other_case,'Synthetic unrelated family',other_staff);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated','aal','aal1','session_id',session,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  set local role authenticated;
  if (select count(*) from public.families) <> 1 or not public.can_access_family(own_case) or public.can_access_family(other_case) then
    raise exception 'Hosted ownership boundary failed';
  end if;
  begin
    update public.app_users set role='admin' where id=staff;
    raise exception 'Hosted self-promotion was not denied';
  exception when insufficient_privilege then null;
  end;
  update public.app_users set display_name='Synthetic profile edit' where id=staff;
  if (select display_name from public.app_users where id=staff) <> 'Synthetic profile edit' then
    raise exception 'Profile editing failed';
  end if;
  reset role;
  update public.app_users set is_active=false where id=staff;
  set local role authenticated;
  if public.is_active_app_user() or public.can_access_family(own_case) or exists (select 1 from public.families) then
    raise exception 'Offboarded session retained access';
  end if;
  reset role;
  update public.app_users set is_active=true where id=staff;
  delete from auth.sessions where id=session;
  set local role authenticated;
  if public.is_active_app_user() or public.can_access_family(own_case) then
    raise exception 'Revoked session retained access';
  end if;
  reset role;
end $$;
rollback;
select 'passed' as synthetic_sql_role_smoke,
  (select count(*) from auth.users) as remaining_auth_users,
  (select count(*) from public.families) as remaining_families;

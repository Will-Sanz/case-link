-- Save the context used by matching and generation in one transaction.
create function public.save_family_planning_context(
  p_family_id uuid,
  p_summary text,
  p_barriers jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
begin
  if (select auth.uid()) is null or not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied' using errcode = '42501';
  end if;
  if char_length(coalesce(p_summary, '')) > 4000 or p_barriers is null then
    raise exception 'invalid planning context' using errcode = '23514';
  end if;
  select updated_at into v_updated_at from public.families where id = p_family_id for update;
  if p_expected_updated_at is null or v_updated_at is distinct from p_expected_updated_at then
    raise exception 'case context changed' using errcode = '40001';
  end if;
  perform public.update_family_meta(p_family_id, jsonb_build_object('summary', nullif(btrim(p_summary), '')));
  perform public.replace_family_barriers(p_family_id, p_barriers);
  select updated_at into v_updated_at from public.families where id = p_family_id;
  return v_updated_at;
end;
$$;

revoke all on function public.save_family_planning_context(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.save_family_planning_context(uuid, text, jsonb, timestamptz) to authenticated;

-- Profile barrier edits must also invalidate an open planning form's revision.
create function private.touch_family_barrier_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.families set updated_at = now() where id = coalesce(new.family_id, old.family_id);
  return coalesce(new, old);
end;
$$;
revoke all on function private.touch_family_barrier_context() from public, anon, authenticated;
create trigger family_barriers_touch_context
  after insert or update or delete on public.family_barriers
  for each row execute function private.touch_family_barrier_context();

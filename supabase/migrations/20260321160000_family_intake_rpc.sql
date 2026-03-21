-- Server-side family row creation: SECURITY DEFINER bypasses RLS on INSERT while still
-- binding created_by_id to auth.uid() (cannot be spoofed from the client).
-- Use when direct PostgREST insert fails RLS despite a valid JWT (e.g. policy/WITH CHECK edge cases).

create or replace function public.create_family_intake_row(
  p_name text,
  p_summary text,
  p_urgency public.family_urgency,
  p_household_notes text,
  p_status public.family_status default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  insert into public.families (
    name,
    summary,
    urgency,
    household_notes,
    status,
    created_by_id
  )
  values (
    p_name,
    p_summary,
    p_urgency,
    p_household_notes,
    coalesce(p_status, 'active'),
    (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_family_intake_row(text, text, public.family_urgency, text, public.family_status) from public;
grant execute on function public.create_family_intake_row(text, text, public.family_urgency, text, public.family_status) to authenticated;

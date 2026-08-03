-- Atomically replace a family's barriers. This prevents a failed insert from
-- leaving the family with no saved barriers after the old rows are removed.
create or replace function public.replace_family_barriers(
  p_family_id uuid,
  p_barriers jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_barrier jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  if not public.can_access_family(p_family_id) then
    raise exception 'family not found or access denied';
  end if;

  if jsonb_typeof(coalesce(p_barriers, '[]'::jsonb)) <> 'array' then
    raise exception 'barriers must be an array';
  end if;

  if jsonb_array_length(coalesce(p_barriers, '[]'::jsonb)) > 50 then
    raise exception 'too many barriers';
  end if;

  delete from public.family_barriers where family_id = p_family_id;

  for v_barrier in
    select value from jsonb_array_elements(coalesce(p_barriers, '[]'::jsonb))
  loop
    if nullif(btrim(v_barrier ->> 'label'), '') is null then
      raise exception 'barrier label is required';
    end if;

    insert into public.family_barriers (family_id, preset_key, label, sort_order)
    values (
      p_family_id,
      nullif(btrim(v_barrier ->> 'preset_key'), ''),
      left(btrim(v_barrier ->> 'label'), 200),
      greatest(0, coalesce((v_barrier ->> 'sort_order')::int, 0))
    );
  end loop;
end;
$$;

revoke all on function public.replace_family_barriers(uuid, jsonb) from public;
grant execute on function public.replace_family_barriers(uuid, jsonb) to authenticated;

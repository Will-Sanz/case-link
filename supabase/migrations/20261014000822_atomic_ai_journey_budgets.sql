-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.consume_ai_budget (
  p_operation text,
  p_weight    integer DEFAULT 1
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_operation_limit integer;
  v_operation_window integer;
  v_window_start timestamptz;
  v_remaining integer;
  v_retry_after integer;
  v_scope text;
  v_denial_reason text;
begin
  if not public.is_active_app_user() then
    raise exception 'account is not provisioned' using errcode = '42501';
  end if;
  if p_weight is null or p_weight not between 1 and 10 then
    raise exception 'invalid AI request weight' using errcode = '23514';
  end if;
  if v_operation not in ('helper', 'chat', 'plan', 'plan_phase', 'pdf_mapping') then
    raise exception 'invalid AI operation' using errcode = '23514';
  end if;
  if not coalesce((select ai_enabled from private.production_controls where singleton), false) then
    return jsonb_build_object('allowed', false, 'retryAfter', 3600, 'reason', 'disabled');
  end if;

  if v_operation = 'pdf_mapping' then
    v_operation_limit := 3;
    v_operation_window := 600;
  elsif v_operation = 'plan_phase' then
    v_operation_limit := 16;
    v_operation_window := 600;
  elsif v_operation = 'plan' then
    v_operation_limit := 12;
    v_operation_window := 600;
  else
    v_operation_limit := 30;
    v_operation_window := 60;
  end if;

  -- All counters commit together; a later rejection rolls back earlier reservations.
  begin
  -- Operation-specific user budget.
  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / v_operation_window) * v_operation_window
  );
  v_scope := 'user:' || v_user_id::text || ':operation:' || v_operation;
  if p_weight > v_operation_limit then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => v_operation_window) - v_now)))::integer);
    v_denial_reason := 'operation';
    raise exception 'AI budget reached' using errcode='PCL10';
  end if;
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values (v_scope, v_window_start, v_operation_window, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= v_operation_limit
  returning v_operation_limit - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => v_operation_window) - v_now)))::integer);
    v_denial_reason := 'operation';
    raise exception 'AI budget reached' using errcode='PCL10';
  end if;

  -- Aggregate per-user hourly budget.
  v_window_start := to_timestamp(floor(extract(epoch from v_now) / 3600) * 3600);
  v_scope := 'user:' || v_user_id::text || ':hour';
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values (v_scope, v_window_start, 3600, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= 120
  returning 120 - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + interval '1 hour' - v_now)))::integer);
    v_denial_reason := 'user_hour';
    raise exception 'AI budget reached' using errcode='PCL10';
  end if;

  -- A deployment is one tenant in the pilot, so this is also the tenant daily budget.
  v_window_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  insert into private.ai_rate_counters (scope_key, window_start, window_seconds, used)
  values ('deployment:day', v_window_start, 86400, p_weight)
  on conflict (scope_key, window_start, window_seconds) do update
    set used = private.ai_rate_counters.used + excluded.used
    where private.ai_rate_counters.used + excluded.used <= 2000
  returning 2000 - used into v_remaining;
  if not found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + interval '1 day' - v_now)))::integer);
    v_denial_reason := 'deployment_day';
    raise exception 'AI budget reached' using errcode='PCL10';
  end if;

  exception when sqlstate 'PCL10' then
    return jsonb_build_object('allowed', false, 'retryAfter', v_retry_after, 'reason', v_denial_reason);
  end;

  delete from private.ai_rate_counters
  where window_start + make_interval(secs => window_seconds) < v_now - interval '1 day';

  return jsonb_build_object('allowed', true, 'retryAfter', 0, 'remaining', v_remaining);
end;
$function$;

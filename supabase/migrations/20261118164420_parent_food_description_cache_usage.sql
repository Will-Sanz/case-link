-- Sol cache-write counts are disjoint input subsets, retained as exact billing evidence.
create or replace function parent_private.parent_record_food_description_usage(p_charge uuid,p_usage jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_usage is null or jsonb_typeof(p_usage)<>'object' then
    raise exception 'description invalid usage' using errcode='23514'; end if;
  if p_usage-array['inputTokens','outputTokens','cachedInputTokens','cacheWriteInputTokens','cacheWrite30mInputTokens','cacheWrite12hInputTokens','reasoningTokens','responseId','requestId','complete']<>'{}'::jsonb
    or pg_column_size(p_usage)>1024 or jsonb_typeof(p_usage->'complete') is distinct from 'boolean'
    or exists(select 1 from jsonb_each(p_usage) item where case
      when item.key in ('responseId','requestId') then jsonb_typeof(item.value)<>'string' or (item.value#>>'{}') !~ '^[A-Za-z0-9_-]{1,200}$'
      when item.key<>'complete' then case when jsonb_typeof(item.value)<>'number' or (item.value#>>'{}') !~ '^[0-9]{1,8}$' then true else (item.value#>>'{}')::bigint>10000000 end
      else false end)
    then raise exception 'description invalid usage' using errcode='23514'; end if;
  if (p_usage->'complete'='true' and (not(p_usage ?& array['inputTokens','outputTokens','cachedInputTokens','reasoningTokens'])
      or (p_usage->>'cachedInputTokens')::bigint>(p_usage->>'inputTokens')::bigint or (p_usage->>'reasoningTokens')::bigint>(p_usage->>'outputTokens')::bigint))
    or (p_usage ?| array['cacheWriteInputTokens','cacheWrite30mInputTokens','cacheWrite12hInputTokens'] and (not(p_usage ?& array['cacheWriteInputTokens','cacheWrite30mInputTokens','cacheWrite12hInputTokens'])
      or (p_usage->>'cacheWriteInputTokens')::bigint<>(p_usage->>'cacheWrite30mInputTokens')::bigint+(p_usage->>'cacheWrite12hInputTokens')::bigint
      or (p_usage->>'cachedInputTokens')::bigint+(p_usage->>'cacheWriteInputTokens')::bigint>(p_usage->>'inputTokens')::bigint))
    or (p_usage->'complete'='false' and p_usage-array['complete','responseId','requestId']<>'{}'::jsonb)
    then raise exception 'description invalid usage' using errcode='23514'; end if;
  update parent_private.food_description_calls set usage=p_usage where charge_token=p_charge and usage is null;
end $$;

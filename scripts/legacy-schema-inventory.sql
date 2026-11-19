-- Read-only application definitions. Never selects application or Auth row contents.
with relations as (
  select c.*, n.nspname as schema_name
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','v','m','S','f')
), routines as (
  select p.*, n.nspname as schema_name
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
), objects as (
  select 'relation' as kind, schema_name||'.'||relname as name, relacl as acl from relations
  union all
  select 'function', schema_name||'.'||proname||'('||pg_get_function_identity_arguments(oid)||')',
    coalesce(proacl,acldefault('f',proowner)) from routines
  union all
  select 'column', c.schema_name||'.'||c.relname||'.'||a.attname, a.attacl
    from relations c join pg_attribute a on a.attrelid=c.oid where a.attnum>0 and not a.attisdropped
)
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object('name',schema_name||'.'||relname,'kind',relkind,
    'rls',relrowsecurity,'forceRls',relforcerowsecurity,'owner',pg_get_userbyid(relowner))
    order by schema_name,relname) from relations),
  'columns', (select jsonb_agg(jsonb_build_object('table',c.schema_name||'.'||c.relname,'name',a.attname,
    'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
    order by c.schema_name,c.relname,a.attnum)
    from relations c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum),
  'types', (select jsonb_agg(t order by t.name) from (
    select n.nspname||'.'||typ.typname as name,array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type typ join pg_namespace n on n.oid=typ.typnamespace join pg_enum e on e.enumtypid=typ.oid
    where n.nspname in ('public','private') group by n.nspname,typ.typname) t),
  'constraints', (select jsonb_agg(jsonb_build_object('table',c.schema_name||'.'||c.relname,'name',co.conname,
    'definition',pg_get_constraintdef(co.oid,true),'type',co.contype,'validated',co.convalidated)
    order by c.schema_name,c.relname,co.conname) from pg_constraint co join relations c on c.oid=co.conrelid),
  'indexes', (select jsonb_agg(jsonb_build_object('table',schemaname||'.'||tablename,'name',indexname,'definition',indexdef)
    order by schemaname,tablename,indexname) from pg_indexes where schemaname in ('public','private')),
  'policies', (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname)
    from pg_policies p where schemaname in ('public','private')),
  'functions', (select jsonb_agg(jsonb_build_object('name',schema_name||'.'||proname,
    'identityArgs',pg_get_function_identity_arguments(oid),'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner))
    order by schema_name,proname,pg_get_function_identity_arguments(oid)) from routines),
  'triggers', (select jsonb_agg(jsonb_build_object('table',c.schema_name||'.'||c.relname,'name',t.tgname,
    'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by c.schema_name,c.relname,t.tgname)
    from pg_trigger t join relations c on c.oid=t.tgrelid where not t.tgisinternal),
  'grants', (select jsonb_agg(jsonb_build_object('kind',o.kind,'name',o.name,'grantor',pg_get_userbyid(a.grantor),
    'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by o.kind,o.name,pg_get_userbyid(a.grantor),a.grantee,a.privilege_type)
    from objects o cross join lateral aclexplode(o.acl) a),
  'defaults', (select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),
    'schema',coalesce(n.nspname,''),'kind',d.defaclobjtype,
    'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype,a.grantee,a.privilege_type)
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where (d.defaclnamespace=0 or n.nspname in ('public','private')) and pg_get_userbyid(d.defaclrole)='postgres')
) as schema_snapshot;

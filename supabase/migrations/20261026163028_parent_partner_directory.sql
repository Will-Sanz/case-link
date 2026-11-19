-- Reuse verified directory organizations without publishing the staff contact directory.
create function public.parent_partner_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_partners jsonb;
begin
  if not public.is_parent_session() then
    raise exception 'verified parent session required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'legacyResourceId',r.id,
    'name',p.name,
    'officialUrl',p.official_url,
    'programIds',p.program_ids,
    'directoryUpdatedAt',r.updated_at,
    'sourceCheckedAt','2026-10-26',
    'relationship','existing_partner',
    'execution','not_connected'
  ) order by p.name,r.id),'[]'::jsonb) into v_partners
  from public.resources r join (values
    ('uesf-utility-emergency-service-funding-9b971619','UESF','https://uesfacts.org/check-your-eligibility/',array['uesf-benefits','uesf-utilities']),
    ('peco-utility-information-on-electric-service-1c757482','PECO','https://www.peco.com/my-account/customer-support/assistance-programs',array['peco-cap']),
    ('philadelphia-water-department-pwd-customer-assistance-program-cap-ff6c8f8b','Philadelphia Water Department customer assistance','https://cap.phila.gov/',array['pwd-tap']),
    ('the-philadelphia-water-department-water-assistance-programs-4be363a6','Philadelphia Water Department assistance programs','https://cap.phila.gov/',array['pwd-tap'])
  ) p(slug,name,official_url,program_ids) on r.slug=p.slug
  where r.active and not r.is_demo;
  return v_partners;
end $$;
revoke execute on function public.parent_partner_directory()
  from public,anon,authenticated,service_role,parent_worker,parent_retention_worker,parent_storage_broker;
grant execute on function public.parent_partner_directory() to authenticated;

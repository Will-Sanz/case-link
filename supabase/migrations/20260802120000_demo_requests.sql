create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254),
  organization text not null check (char_length(organization) between 2 and 160),
  role text not null check (char_length(role) between 2 and 120),
  message text check (message is null or char_length(message) <= 1500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.demo_requests enable row level security;
revoke all on table public.demo_requests from anon, authenticated;
grant all on table public.demo_requests to service_role;

comment on table public.demo_requests is
  'Business contact requests from the public CaseLink site. Server-only service-role access.';

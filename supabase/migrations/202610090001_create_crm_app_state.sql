create table if not exists public.crm_app_state (
  id text primary key check (id = 'main'),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.crm_app_state enable row level security;
revoke all on table public.crm_app_state from public, anon, authenticated;
grant select, update on table public.crm_app_state to service_role;

insert into public.crm_app_state (id, data)
values ('main', jsonb_build_object(
  'id','state',
  'page','dashboard',
  'leads','[]'::jsonb,
  'tasks','[]'::jsonb,
  'sales','[]'::jsonb,
  'settings',jsonb_build_object('studioName','Studio Pâmela Pastore','primary','#1A8690')
))
on conflict (id) do nothing;

drop policy if exists "deny public access to crm app state" on public.crm_app_state;
create policy "deny public access to crm app state"
on public.crm_app_state
for all
to anon, authenticated
using (false)
with check (false);

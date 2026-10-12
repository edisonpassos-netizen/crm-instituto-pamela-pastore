-- Automation engine foundation. No existing CRM rows are modified.
-- Public/anon/authenticated access remains revoked; backend service role only.
create table if not exists public.crm_automation_queue (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  event_type text not null,
  source_type text not null,
  source_id text not null,
  recipient_phone text,
  payload jsonb not null default '{}'::jsonb,
  channel text not null default 'internal' check (channel in ('internal','whatsapp','google_review')),
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','completed','cancelled','dead_letter')),
  scheduled_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  locked_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crm_automation_queue_due_idx
  on public.crm_automation_queue (scheduled_at, created_at)
  where status in ('pending','retry');
create index if not exists crm_automation_queue_lock_idx
  on public.crm_automation_queue (locked_at)
  where status = 'processing';

create table if not exists public.crm_automation_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.crm_automation_queue(id) on delete cascade,
  attempt_number integer not null,
  outcome text not null check (outcome in ('started','succeeded','retry_scheduled','failed','skipped')),
  detail text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (queue_id, attempt_number, outcome)
);
create index if not exists crm_automation_attempts_queue_idx
  on public.crm_automation_attempts (queue_id, created_at desc);

alter table public.crm_automation_queue enable row level security;
alter table public.crm_automation_attempts enable row level security;
revoke all on table public.crm_automation_queue, public.crm_automation_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_automation_queue, public.crm_automation_attempts to service_role;

-- Atomic claim: concurrent workers cannot claim the same due item.
create or replace function public.claim_due_automation_jobs(p_limit integer default 10)
returns setof public.crm_automation_queue
language sql
security definer
set search_path = pg_catalog, public
as $$
  with due as (
    select q.id
    from public.crm_automation_queue q
    where (
      (q.status in ('pending','retry') and q.scheduled_at <= now())
      or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
    )
    order by q.scheduled_at, q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.crm_automation_queue q
  set status = 'processing',
      locked_at = now(),
      attempts = q.attempts + 1,
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
$$;

revoke all on function public.claim_due_automation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_automation_jobs(integer) to service_role;

-- Enqueue uses a unique dedupe key; repeat events return the existing item.
create or replace function public.enqueue_crm_automation(
  p_dedupe_key text,
  p_event_type text,
  p_source_type text,
  p_source_id text,
  p_recipient_phone text,
  p_payload jsonb,
  p_channel text,
  p_scheduled_at timestamptz default now(),
  p_max_attempts integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  insert into public.crm_automation_queue (
    dedupe_key, event_type, source_type, source_id, recipient_phone,
    payload, channel, scheduled_at, max_attempts
  ) values (
    p_dedupe_key, p_event_type, p_source_type, p_source_id, p_recipient_phone,
    coalesce(p_payload, '{}'::jsonb), p_channel, coalesce(p_scheduled_at, now()),
    greatest(1, least(coalesce(p_max_attempts, 5), 10))
  )
  on conflict (dedupe_key) do update
    set dedupe_key = excluded.dedupe_key
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer) to service_role;

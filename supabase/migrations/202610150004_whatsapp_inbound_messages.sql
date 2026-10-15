create table if not exists public.crm_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  phone_number_id text,
  contact_wa_id text not null,
  contact_name text,
  message_type text not null,
  text_body text,
  provider_timestamp timestamptz,
  message_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_whatsapp_messages_contact_idx
  on public.crm_whatsapp_messages(contact_wa_id, provider_timestamp desc);

alter table public.crm_whatsapp_messages enable row level security;
revoke all on table public.crm_whatsapp_messages from public, anon, authenticated;
grant select, insert on table public.crm_whatsapp_messages to service_role;

drop policy if exists "deny public access to crm whatsapp messages" on public.crm_whatsapp_messages;
create policy "deny public access to crm whatsapp messages"
on public.crm_whatsapp_messages
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.ingest_whatsapp_inbound_message(
  p_provider_message_id text,
  p_phone_number_id text,
  p_contact_wa_id text,
  p_contact_name text,
  p_message_type text,
  p_text_body text,
  p_provider_timestamp timestamptz,
  p_message_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_inserted boolean := false;
begin
  if coalesce(length(trim(p_provider_message_id)), 0) = 0
     or coalesce(length(trim(p_contact_wa_id)), 0) = 0
     or coalesce(length(trim(p_message_type)), 0) = 0 then
    raise exception 'Missing required WhatsApp message fields' using errcode = '22023';
  end if;

  insert into public.crm_whatsapp_messages (
    provider_message_id,
    direction,
    phone_number_id,
    contact_wa_id,
    contact_name,
    message_type,
    text_body,
    provider_timestamp,
    message_payload
  ) values (
    left(trim(p_provider_message_id), 255),
    'inbound',
    nullif(left(trim(coalesce(p_phone_number_id, '')), 100), ''),
    left(trim(p_contact_wa_id), 32),
    nullif(left(trim(coalesce(p_contact_name, '')), 200), ''),
    left(trim(p_message_type), 80),
    case when p_text_body is null then null else left(p_text_body, 4000) end,
    p_provider_timestamp,
    coalesce(p_message_payload, '{}'::jsonb)
  )
  on conflict (provider_message_id) do nothing
  returning id into v_id;

  if v_id is not null then
    v_inserted := true;
  else
    select id into v_id
    from public.crm_whatsapp_messages
    where provider_message_id = left(trim(p_provider_message_id), 255);
  end if;

  return jsonb_build_object('id', v_id, 'inserted', v_inserted);
end;
$$;

revoke all on function public.ingest_whatsapp_inbound_message(text,text,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_inbound_message(text,text,text,text,text,text,timestamptz,jsonb) to service_role;

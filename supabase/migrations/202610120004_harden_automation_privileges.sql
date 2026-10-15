-- Security hardening for the CRM automation surface.
-- Proposed migration only. Do not apply to the official Supabase project without explicit approval.
-- Preserve normal DML privileges governed by existing RLS policies on business tables.
begin;

do $$
declare
  r record;
begin
  -- RLS does not protect TRUNCATE, REFERENCES, TRIGGER or (on PostgreSQL 17+)
  -- MAINTAIN. Remove these unnecessary table-level privileges from API roles.
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from anon, authenticated',
      r.nspname, r.relname
    );
    if current_setting('server_version_num')::integer >= 170000 then
      execute format(
        'revoke maintain on table %I.%I from anon, authenticated',
        r.nspname, r.relname
      );
    end if;
  end loop;

  -- These legacy automation tables have RLS enabled but no policies and are not
  -- part of the current crm-state snapshot API. Remove direct API-role grants.
  if to_regclass('public.crm_automation_rules') is not null then
    revoke all privileges on table public.crm_automation_rules from anon, authenticated;
  end if;
  if to_regclass('public.crm_automation_runs') is not null then
    revoke all privileges on table public.crm_automation_runs from anon, authenticated;
  end if;
end
$$;

-- Queue and attempt history are backend-only. No browser/API role access.
revoke all privileges on table public.crm_automation_queue, public.crm_automation_attempts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_automation_queue, public.crm_automation_attempts
  to service_role;

-- SECURITY DEFINER RPCs must be callable only by the server service role.
revoke all on function public.claim_due_automation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_automation_jobs(integer) to service_role;

revoke all on function public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer)
  to service_role;

-- Secure-by-default for objects created by the migration owner in public.
-- Future migrations must grant only the privileges each object explicitly needs.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

commit;

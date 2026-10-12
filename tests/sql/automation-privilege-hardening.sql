\set ON_ERROR_STOP on

-- Verify that queue tables are not exposed to API roles.
do $$
begin
  if has_table_privilege('anon', 'public.crm_automation_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.crm_automation_queue', 'SELECT')
     or has_table_privilege('anon', 'public.crm_automation_attempts', 'INSERT')
     or has_table_privilege('authenticated', 'public.crm_automation_attempts', 'INSERT') then
    raise exception 'API roles retain direct privileges on automation queue tables';
  end if;

  if not has_table_privilege('service_role', 'public.crm_automation_queue', 'SELECT')
     or not has_table_privilege('service_role', 'public.crm_automation_queue', 'UPDATE')
     or not has_table_privilege('service_role', 'public.crm_automation_attempts', 'INSERT') then
    raise exception 'service_role is missing required automation privileges';
  end if;

  if has_function_privilege('anon', 'public.claim_due_automation_jobs(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_due_automation_jobs(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_crm_automation(text,text,text,text,text,jsonb,text,timestamptz,integer)', 'EXECUTE') then
    raise exception 'API roles retain EXECUTE on privileged automation RPCs';
  end if;

  if has_table_privilege('authenticated', 'public.crm_automation_queue', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.crm_automation_queue', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.crm_automation_attempts', 'REFERENCES') then
    raise exception 'authenticated retains a non-DML table privilege';
  end if;
end
$$;

-- Probe default ACLs for objects created by the migration owner; no business data is used.
create table public.__privilege_default_probe (id bigint);
do $$
begin
  if has_table_privilege('anon', 'public.__privilege_default_probe', 'SELECT')
     or has_table_privilege('authenticated', 'public.__privilege_default_probe', 'SELECT')
     or has_table_privilege('authenticated', 'public.__privilege_default_probe', 'TRUNCATE') then
    raise exception 'API roles receive unexpected default privileges on new public tables';
  end if;
end
$$;
drop table public.__privilege_default_probe;

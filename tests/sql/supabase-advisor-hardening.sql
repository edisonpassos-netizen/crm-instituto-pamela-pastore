\set ON_ERROR_STOP on

-- Explicit deny policies must exist on all three server-only tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_app_state','crm_automation_queue','crm_automation_attempts']
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname='public'
        and tablename=v_table
        and roles @> array['anon'::name]
        and roles @> array['authenticated'::name]
        and cmd='ALL'
        and qual='false'
        and with_check='false'
    ) then
      raise exception 'explicit deny policy missing or incorrect on %', v_table;
    end if;
  end loop;
end $$;

-- Public client roles must remain without direct table privileges.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_app_state','crm_automation_queue','crm_automation_attempts']
  loop
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'anon unexpectedly has DML privilege on %', v_table;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'authenticated unexpectedly has DML privilege on %', v_table;
    end if;
  end loop;
end $$;

-- Every queue foreign key in customer experience must have a covering index.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='crm_customer_experience' and indexname='crm_customer_experience_request_queue_id_idx') then
    raise exception 'request_queue_id covering index missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='crm_customer_experience' and indexname='crm_customer_experience_recovery_queue_id_idx') then
    raise exception 'recovery_queue_id covering index missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='crm_customer_experience' and indexname='crm_customer_experience_review_queue_id_idx') then
    raise exception 'review_queue_id covering index missing';
  end if;
end $$;

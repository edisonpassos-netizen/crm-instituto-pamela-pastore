-- Harden the main CRM follow-up trigger so malformed JSON snapshots cannot
-- create queue items for leads that do not exist in the same persisted state.
-- This replaces only the trigger function; existing queue rows are untouched.

create or replace function public.enqueue_new_main_crm_followups()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task jsonb;
  v_task_id text;
  v_lead_id text;
begin
  if new.id <> 'main' or new.data is null then
    return new;
  end if;

  for v_task in
    select item
    from jsonb_array_elements(coalesce(new.data->'tasks', '[]'::jsonb)) as t(item)
  loop
    v_task_id := nullif(btrim(v_task->>'id'), '');
    v_lead_id := nullif(btrim(v_task->>'leadId'), '');

    if v_task_id is null or v_lead_id is null then
      continue;
    end if;

    if lower(coalesce(v_task->>'done', 'false')) = 'true' then
      continue;
    end if;

    if coalesce(v_task->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      continue;
    end if;

    -- A queued follow-up must always reference a lead present in the same
    -- persisted CRM snapshot. This prevents avoidable dead-letter jobs after
    -- malformed imports or stale client state.
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(new.data->'leads', '[]'::jsonb)) as l(item)
      where l.item->>'id' = v_lead_id
    ) then
      continue;
    end if;

    -- Only task IDs absent from the previous state are emitted. Edits do not
    -- create duplicate automation jobs.
    if exists (
      select 1
      from jsonb_array_elements(coalesce(old.data->'tasks', '[]'::jsonb)) as o(item)
      where o.item->>'id' = v_task_id
    ) then
      continue;
    end if;

    perform public.enqueue_crm_automation(
      'crm:lead_follow_up_requested:task:' || v_task_id,
      'lead_follow_up_requested',
      'task',
      v_task_id,
      null,
      jsonb_build_object(
        'source_type', 'task',
        'source_id', v_task_id,
        'occurred_at', now(),
        'task', 'follow_up_lead',
        'origin', 'crm_app_state_trigger'
      ),
      'internal',
      now(),
      3
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_new_main_crm_followups() from public, anon, authenticated;
grant execute on function public.enqueue_new_main_crm_followups() to service_role;

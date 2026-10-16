\set ON_ERROR_STOP on

-- crm_app_state is created here because the automation integration workflow
-- historically starts from the queue migration, not the app-state migration.
create table if not exists public.crm_app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.crm_app_state(id, data, revision)
values (
  'main',
  jsonb_build_object(
    'leads', jsonb_build_array(jsonb_build_object('id','lead-1','name','Cliente Teste','phone','5515999999999')),
    'tasks', '[]'::jsonb,
    'sales', '[]'::jsonb,
    'attendances', '[]'::jsonb
  ),
  1
)
on conflict (id) do update
set data = excluded.data,
    revision = excluded.revision,
    updated_at = now(),
    updated_by = 'test-reset';

delete from public.crm_automation_attempts;
delete from public.crm_automation_queue;

-- A new valid pending task is atomically enqueued.
update public.crm_app_state
set data = jsonb_set(
      data,
      '{tasks}',
      jsonb_build_array(jsonb_build_object(
        'id','task-main-1',
        'leadId','lead-1',
        'date','2026-10-17',
        'type','WhatsApp',
        'note','Retorno de teste',
        'done',false
      )),
      true
    ),
    revision = revision + 1,
    updated_at = now();

do $$
begin
  if (select count(*) from public.crm_automation_queue where dedupe_key='crm:lead_follow_up_requested:task:task-main-1') <> 1 then
    raise exception 'new main CRM task was not enqueued exactly once';
  end if;
  if exists (
    select 1 from public.crm_automation_queue
    where dedupe_key='crm:lead_follow_up_requested:task:task-main-1'
      and (channel <> 'internal' or event_type <> 'lead_follow_up_requested' or source_type <> 'task' or source_id <> 'task-main-1')
  ) then
    raise exception 'main CRM follow-up queue metadata is incorrect';
  end if;
end $$;

-- Editing the same task must not create another job.
update public.crm_app_state
set data = jsonb_set(data, '{tasks,0,note}', to_jsonb('Observação alterada'::text), true),
    revision = revision + 1,
    updated_at = now();

do $$
begin
  if (select count(*) from public.crm_automation_queue where dedupe_key='crm:lead_follow_up_requested:task:task-main-1') <> 1 then
    raise exception 'editing an existing task created a duplicate job';
  end if;
end $$;

-- New completed/malformed/orphan tasks are intentionally ignored.
update public.crm_app_state
set data = jsonb_set(
      data,
      '{tasks}',
      (data->'tasks') || jsonb_build_array(
        jsonb_build_object('id','task-done','leadId','lead-1','date','2026-10-17','done',true),
        jsonb_build_object('id','task-no-lead','date','2026-10-17','done',false),
        jsonb_build_object('id','task-bad-date','leadId','lead-1','date','amanha','done',false),
        jsonb_build_object('id','task-orphan','leadId','lead-does-not-exist','date','2026-10-17','done',false)
      ),
      true
    ),
    revision = revision + 1,
    updated_at = now();

do $$
begin
  if exists (select 1 from public.crm_automation_queue where source_id in ('task-done','task-no-lead','task-bad-date','task-orphan')) then
    raise exception 'invalid, completed or orphan task was enqueued';
  end if;
end $$;

-- Public client roles cannot execute the trigger function directly.
do $$
begin
  if has_function_privilege('anon', 'public.enqueue_new_main_crm_followups()', 'EXECUTE') then
    raise exception 'anon unexpectedly has trigger-function execute privilege';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_new_main_crm_followups()', 'EXECUTE') then
    raise exception 'authenticated unexpectedly has trigger-function execute privilege';
  end if;
end $$;

\set ON_ERROR_STOP on
-- Disposable CI database only. Never execute this file against a hosted project.
DO $$ BEGIN
 IF current_database() <> 'automation_test' THEN RAISE EXCEPTION 'E2E fixture reset requires automation_test'; END IF;
END $$;
TRUNCATE public.crm_automation_attempts, public.crm_customer_experience, public.crm_whatsapp_messages, public.crm_automation_queue CASCADE;
UPDATE public.crm_app_state SET data='{"id":"state","page":"dashboard","leads":[],"tasks":[],"sales":[],"attendances":[],"settings":{"studioName":"QA Synthetic","primary":"#1A8690"}}'::jsonb,revision=1,updated_by='synthetic-e2e-fixture' WHERE id='main';

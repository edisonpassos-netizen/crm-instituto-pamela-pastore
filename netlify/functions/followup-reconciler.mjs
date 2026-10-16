import { randomUUID } from 'node:crypto';
import { crmDatabaseConfig } from './lib/crm-database.mjs';

const DEFAULT_LIMIT = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function supabaseConfig(env = process.env) {
  const { url, key } = crmDatabaseConfig(env);
  return { base: url, key };
}

function serverHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function dbRequest(path, method = 'GET', body = null, env = process.env) {
  const { base, key } = supabaseConfig(env);
  const headers = serverHeaders(key, { Accept: 'application/json' });
  const options = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}/rest/v1/${path}`, options);
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${parsed?.message || 'falha na reconciliação'}`);
  return parsed;
}

function validSourceTask(task, leadIds) {
  const id = String(task?.id || '').trim();
  const leadId = String(task?.leadId || '').trim();
  const date = String(task?.date || '').trim();
  return Boolean(task && task.done !== true && id && leadId && DATE_RE.test(date) && leadIds.has(leadId));
}

function pendingUnqueuedTasks(data, queuedSourceIds = new Set(), limit = DEFAULT_LIMIT) {
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const leadIds = new Set((Array.isArray(data?.leads) ? data.leads : []).map(lead => String(lead?.id || '').trim()).filter(Boolean));
  return tasks
    .filter(task => validSourceTask(task, leadIds))
    .filter(task => !queuedSourceIds.has(String(task.id)))
    .sort((a, b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || DEFAULT_LIMIT)));
}

function queueCommand(task, now = new Date()) {
  const sourceId = String(task?.id || '').trim();
  if (!sourceId) throw new Error('Follow-up sem identificador não pode ser reconciliado.');
  return {
    p_dedupe_key: `crm:lead_follow_up_requested:task:${sourceId}`,
    p_event_type: 'lead_follow_up_requested',
    p_source_type: 'task',
    p_source_id: sourceId,
    p_recipient_phone: null,
    p_payload: {
      source_type: 'task',
      source_id: sourceId,
      occurred_at: now.toISOString(),
      task: 'follow_up_lead',
      origin: 'followup_reconciler',
      reconciled: true
    },
    p_channel: 'internal',
    p_scheduled_at: now.toISOString(),
    p_max_attempts: 3
  };
}

async function reconcileFollowUps(env = process.env) {
  if (String(env.INTERNAL_AUTOMATIONS_ENABLED || '').trim().toLowerCase() !== 'true') {
    return { disabled: true, scanned: 0, missing: 0, enqueued: 0, failures: [] };
  }

  const stateRows = await dbRequest('crm_app_state?id=eq.main&select=data', 'GET', null, env);
  const data = Array.isArray(stateRows) ? stateRows[0]?.data : null;
  if (!data || typeof data !== 'object') throw new Error('Estado principal do CRM indisponível para reconciliação.');

  const queueRows = await dbRequest(
    'crm_automation_queue?event_type=eq.lead_follow_up_requested&source_type=eq.task&select=source_id&limit=5000',
    'GET',
    null,
    env
  );
  const queued = new Set((Array.isArray(queueRows) ? queueRows : []).map(row => String(row?.source_id || '')).filter(Boolean));
  const leadIds = new Set((Array.isArray(data.leads) ? data.leads : []).map(lead => String(lead?.id || '').trim()).filter(Boolean));
  const allEligible = (Array.isArray(data.tasks) ? data.tasks : []).filter(task => validSourceTask(task, leadIds));
  const missing = pendingUnqueuedTasks(data, queued, env.FOLLOWUP_RECONCILE_LIMIT || DEFAULT_LIMIT);
  const failures = [];
  let enqueued = 0;

  for (const task of missing) {
    try {
      await dbRequest('rpc/enqueue_crm_automation', 'POST', queueCommand(task), env);
      enqueued += 1;
    } catch (error) {
      failures.push({ sourceId: String(task.id), message: String(error?.message || 'falha').slice(0, 180) });
    }
  }

  return {
    disabled: false,
    scanned: allEligible.length,
    missing: missing.length,
    enqueued,
    failures
  };
}

export const config = { schedule: '*/10 * * * *' };

export default async () => {
  const requestId = randomUUID();
  try {
    const result = await reconcileFollowUps(process.env);
    return new Response(JSON.stringify({ ok: true, requestId, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('follow-up reconciliation failed:', { requestId, message: error?.message || 'unknown' });
    return new Response(JSON.stringify({ ok: false, requestId }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};

export const __test = { supabaseConfig, serverHeaders, validSourceTask, pendingUnqueuedTasks, queueCommand, reconcileFollowUps, dbRequest };

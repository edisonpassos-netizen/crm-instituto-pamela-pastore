import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

function response(status = 201, body = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

function setupState(data, requests, beforeState = null) {
  globalThis.fetch = async (url, options = {}) => {
    const record = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(record);
    if (String(url).includes('/rest/v1/crm_app_state')) {
      if (beforeState) return beforeState(record);
      return response(200, [{ data }]);
    }
    return response(201, []);
  };
}

const task = (overrides = {}) => ({
  id: 'task-fixture-1', leadId: 'lead-fixture-1',
  date: '2026-10-12', type: 'WhatsApp', note: 'Retornar sobre Pilates',
  done: false, ...overrides
});
const lead = (overrides = {}) => ({
  id: 'lead-fixture-1', name: 'Maria Fixture', phone: '5515999999999', ...overrides
});
const job = (overrides = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  channel: 'internal', event_type: 'lead_follow_up_requested',
  source_type: 'task', source_id: 'task-fixture-1',
  attempts: 1, max_attempts: 3, payload: { task: 'follow_up_lead' }, ...overrides
});

test('follow-up retries transient CRM read failures without claiming dispatch', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  let failFirstRead = true;
  setupState({ tasks: [task()], leads: [lead()] }, requests, () => {
    if (failFirstRead) { failFirstRead = false; return response(500, { message: 'simulated test failure' }); }
    return response(200, [{ data: { tasks: [task()], leads: [lead()] } }]);
  });
  try {
    await __test.processJob(job());
    const patch = requests.find(r => r.method === 'PATCH');
    assert.equal(patch.body.status, 'retry');
    assert.equal(patch.body.locked_at, null);
    assert.match(patch.body.last_error, /Supabase HTTP 500/);
    assert.ok(requests.some(r => r.body?.outcome === 'retry_scheduled'));
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('future follow-up is rescheduled to its CRM date and does not contact anyone', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  setupState({ tasks: [task({ date: '2099-01-15' })], leads: [lead()] }, requests);
  try {
    await __test.processJob(job());
    const patch = requests.find(r => r.method === 'PATCH');
    assert.equal(patch.body.status, 'pending');
    assert.equal(patch.body.scheduled_at, '2099-01-15T12:00:00.000Z');
    assert.equal(requests.some(r => r.url.includes('graph.facebook.com')), false);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('due follow-up is made available for manual contact, never reported as sent', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  setupState({ tasks: [task()], leads: [lead()] }, requests);
  try {
    await __test.processJob(job());
    const patch = requests.find(r => r.method === 'PATCH');
    const successLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts'));
    assert.equal(patch.body.status, 'awaiting_operator');
    assert.equal(patch.body.payload.dispatch.state, 'ready_for_manual_contact');
    assert.equal(patch.body.payload.dispatch.recipient_phone, '5515999999999');
    assert.equal(successLog.body.outcome, 'succeeded');
    assert.match(successLog.body.detail, /nenhuma mensagem foi enviada/i);
    assert.equal(patch.body.completed_at, undefined);
    assert.equal(requests.some(r => r.url.includes('graph.facebook.com')), false);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('completed CRM task is cancelled and not dispatched', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  setupState({ tasks: [task({ done: true })], leads: [lead()] }, requests);
  try {
    await __test.processJob(job());
    const patch = requests.find(r => r.method === 'PATCH');
    assert.equal(patch.body.status, 'cancelled');
    assert.equal(requests.some(r => r.url.includes('graph.facebook.com')), false);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('follow-up is dead-lettered when source task is absent from persisted CRM state', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  setupState({ tasks: [], leads: [] }, requests);
  try {
    await __test.processJob(job({ source_id: 'missing-task' }));
    const failedLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts'));
    const patch = requests.find(r => r.method === 'PATCH');
    assert.match(failedLog.body.detail, /não encontrado/i);
    assert.equal(patch.body.status, 'dead_letter');
    assert.equal(patch.body.completed_at, undefined);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('worker remains disabled without explicit opt-in and makes no network calls', async () => {
  const previous = { enabled: process.env.AUTOMATIONS_ENABLED, fetch: globalThis.fetch };
  delete process.env.AUTOMATIONS_ENABLED;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network must not be called'); };
  try {
    const worker = (await import('../netlify/functions/automation-worker.mjs')).default;
    const result = await worker();
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, disabled: true });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.enabled === undefined) delete process.env.AUTOMATIONS_ENABLED;
    else process.env.AUTOMATIONS_ENABLED = previous.enabled;
  }
});

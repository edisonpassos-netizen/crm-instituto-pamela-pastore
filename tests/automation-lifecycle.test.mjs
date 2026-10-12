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

test('follow-up reconciliation retries transient DB errors then completes when CRM task exists', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch
  };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  let failFirstRead = true;

  globalThis.fetch = async (url, options = {}) => {
    const record = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(record);
    if (String(url).includes('/rest/v1/crm_app_state') && failFirstRead) {
      failFirstRead = false;
      return response(500, { message: 'simulated test failure' });
    }
    if (String(url).includes('/rest/v1/crm_app_state')) {
      return response(200, [{ data: { tasks: [{ id: 'task-fixture-1' }] } }]);
    }
    return response(201, []);
  };

  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    channel: 'internal',
    event_type: 'lead_follow_up_requested',
    source_type: 'task',
    source_id: 'task-fixture-1',
    attempts: 1,
    max_attempts: 3,
    payload: { task: 'follow_up_lead' }
  };

  try {
    await __test.processJob(job);
    const firstPatch = requests.find(r => r.method === 'PATCH');
    assert.ok(firstPatch, 'transient failure should update queue state');
    assert.equal(firstPatch.body.status, 'retry');
    assert.equal(firstPatch.body.locked_at, null);
    assert.match(firstPatch.body.last_error, /Supabase HTTP 500/);
    assert.ok(requests.some(r => r.body?.outcome === 'retry_scheduled'));

    requests.length = 0;
    await __test.processJob({ ...job, attempts: 2 });
    const successLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts') && r.body?.outcome === 'succeeded');
    const completedPatch = requests.find(r => r.method === 'PATCH');
    assert.ok(successLog, 'confirmed task should create a succeeded attempt');
    assert.match(successLog.body.detail, /confirmado no estado persistido/i);
    assert.ok(completedPatch, 'confirmed task should update queue state');
    assert.equal(completedPatch.body.status, 'completed');
    assert.equal(completedPatch.body.locked_at, null);
    assert.equal(completedPatch.body.last_error, null);
    assert.ok(completedPatch.body.completed_at);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('follow-up event is dead-lettered when source task is absent from persisted CRM state', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/crm_app_state')) return response(200, [{ data: { tasks: [] } }]);
    return response(201, []);
  };
  try {
    await __test.processJob({
      id: '00000000-0000-4000-8000-000000000002',
      channel: 'internal', event_type: 'lead_follow_up_requested',
      source_type: 'task', source_id: 'missing-task', attempts: 1, max_attempts: 3
    });
    const failedLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts') && r.body?.outcome === 'failed');
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

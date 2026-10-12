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

test('internal task lifecycle: transient logging failure retries, then unimplemented task is dead-lettered', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch
  };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const requests = [];
  let failFirstAttemptLog = true;

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/crm_automation_attempts') && failFirstAttemptLog) {
      failFirstAttemptLog = false;
      return response(500, { message: 'simulated test failure' });
    }
    return response(201, []);
  };

  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    channel: 'internal',
    event_type: 'follow_up',
    attempts: 1,
    max_attempts: 3,
    payload: { task: 'fixture-only' }
  };

  try {
    await __test.processJob(job);

    const firstPatch = requests.find(r => r.method === 'PATCH');
    assert.ok(firstPatch, 'failure path should update queue state');
    assert.equal(firstPatch.body.status, 'retry');
    assert.equal(firstPatch.body.locked_at, null);
    assert.match(firstPatch.body.last_error, /Supabase HTTP 500/);

    const retryLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts') && r.body?.outcome === 'retry_scheduled');
    assert.ok(retryLog, 'failure should be logged as retry_scheduled');

    requests.length = 0;
    await __test.processJob({ ...job, attempts: 2 });

    const failedLog = requests.find(r => r.url.includes('/rest/v1/crm_automation_attempts') && r.body?.outcome === 'failed');
    const terminalPatch = requests.find(r => r.method === 'PATCH');
    assert.ok(failedLog, 'unimplemented internal task must be logged as failed');
    assert.match(failedLog.body.detail, /ainda não implementada/i);
    assert.ok(terminalPatch, 'unimplemented task should update queue state');
    assert.equal(terminalPatch.body.status, 'dead_letter');
    assert.equal(terminalPatch.body.locked_at, null);
    assert.match(terminalPatch.body.last_error, /nenhuma ação foi executada/i);
    assert.equal(terminalPatch.body.completed_at, undefined);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
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

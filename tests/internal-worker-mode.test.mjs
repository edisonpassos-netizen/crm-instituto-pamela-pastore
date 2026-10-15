import test from 'node:test';
import assert from 'node:assert/strict';

async function loadWorker() {
  const module = await import(`../netlify/functions/automation-worker.mjs?mode=${Date.now()}-${Math.random()}`);
  return module.default;
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('worker remains fully disabled when neither automation flag is enabled', async () => {
  const previous = {
    external: process.env.AUTOMATIONS_ENABLED,
    internal: process.env.INTERNAL_AUTOMATIONS_ENABLED,
    fetch: globalThis.fetch
  };
  delete process.env.AUTOMATIONS_ENABLED;
  delete process.env.INTERNAL_AUTOMATIONS_ENABLED;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network must not be called'); };
  try {
    const worker = await loadWorker();
    const response = await worker();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, disabled: true });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous.fetch;
    restoreEnv('AUTOMATIONS_ENABLED', previous.external);
    restoreEnv('INTERNAL_AUTOMATIONS_ENABLED', previous.internal);
  }
});

test('internal-only mode claims only internal jobs and never touches external providers', async () => {
  const previous = {
    external: process.env.AUTOMATIONS_ENABLED,
    internal: process.env.INTERNAL_AUTOMATIONS_ENABLED,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch
  };
  process.env.AUTOMATIONS_ENABLED = 'false';
  process.env.INTERNAL_AUTOMATIONS_ENABLED = 'true';
  process.env.SUPABASE_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_synthetic';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response('[]', { status: 200 });
  };
  try {
    const worker = await loadWorker();
    const response = await worker();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'internal_only');
    assert.equal(body.claimed, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/claim_due_internal_automation_jobs$/);
    assert.doesNotMatch(calls[0].url, /graph\.facebook\.com/i);
  } finally {
    globalThis.fetch = previous.fetch;
    restoreEnv('AUTOMATIONS_ENABLED', previous.external);
    restoreEnv('INTERNAL_AUTOMATIONS_ENABLED', previous.internal);
    restoreEnv('SUPABASE_URL', previous.url);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previous.key);
  }
});

test('external mode continues to use the all-channel claim RPC only after explicit opt-in', async () => {
  const previous = {
    external: process.env.AUTOMATIONS_ENABLED,
    internal: process.env.INTERNAL_AUTOMATIONS_ENABLED,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch
  };
  process.env.AUTOMATIONS_ENABLED = 'true';
  process.env.INTERNAL_AUTOMATIONS_ENABLED = 'false';
  process.env.SUPABASE_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_synthetic';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response('[]', { status: 200 });
  };
  try {
    const worker = await loadWorker();
    const response = await worker();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'all');
    assert.equal(body.claimed, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/claim_due_automation_jobs$/);
  } finally {
    globalThis.fetch = previous.fetch;
    restoreEnv('AUTOMATIONS_ENABLED', previous.external);
    restoreEnv('INTERNAL_AUTOMATIONS_ENABLED', previous.internal);
    restoreEnv('SUPABASE_URL', previous.url);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previous.key);
  }
});

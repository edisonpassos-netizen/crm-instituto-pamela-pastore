import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

const CRM_TEST_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
const CRM_TEST_KEY = 'sb_secret_synthetic';

function restore(previous) {
  globalThis.fetch = previous.fetch;
  if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
  if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
}

test('retry delay grows exponentially and is capped', () => {
  assert.equal(__test.retryDelaySeconds(1), 60);
  assert.equal(__test.retryDelaySeconds(2), 120);
  assert.equal(__test.retryDelaySeconds(3), 240);
  assert.equal(__test.retryDelaySeconds(99), 21600);
});

test('review invitation is eligible only as a customer-experience review job', () => {
  const valid = {
    event_type: 'review_invitation', channel: 'google_review', source_type: 'customer_experience',
    source_id: '11111111-1111-4111-8111-111111111111', recipient_phone: '5515999999999'
  };
  assert.equal(__test.isReviewEligible(valid), true);
  assert.equal(__test.isReviewEligible({ ...valid, event_type: 'service_completed' }), false);
  assert.equal(__test.isReviewEligible({ ...valid, source_type: 'attendance' }), false);
  assert.equal(__test.isReviewEligible({ ...valid, recipient_phone: null }), false);
});

test('review message is neutral and includes supplied review URL', () => {
  const msg = __test.reviewMessage({
    recipient_phone: '5515999999999',
    payload: { first_name: 'Maria Silva', google_review_url: 'https://g.page/r/example/review' }
  });
  assert.match(msg, /Olá, Maria!/);
  assert.match(msg, /Se desejar compartilhar sua experiência/i);
  assert.match(msg, /https:\/\/g\.page\/r\/example\/review/);
  assert.doesNotMatch(msg, /5 estrelas/i);
});

test('unimplemented internal task is not reported as successful', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const calls = [];
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return String(url).includes('crm_automation_attempts')
      ? new Response('[]', { status: 201 })
      : new Response(null, { status: 204 });
  };
  try {
    await __test.processJob({ id: 'test-job-id', attempts: 1, max_attempts: 3, channel: 'internal', event_type: 'unknown_internal' });
    const attempt = calls.find(call => call.url.includes('crm_automation_attempts'));
    const update = calls.find(call => call.url.includes('crm_automation_queue'));
    assert.equal(attempt.body.outcome, 'failed');
    assert.match(attempt.body.detail, /reconciliador implementado/i);
    assert.equal(update.body.status, 'dead_letter');
  } finally { restore(previous); }
});

test('satisfaction request rechecks pending experience, phone and consent before send', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const experience = {
    id: '11111111-1111-4111-8111-111111111111', status: 'pending_send',
    recipient_phone: '5515999999999', first_name: 'Maria', service_name: 'Pilates'
  };
  globalThis.fetch = async () => new Response(JSON.stringify([experience]), { status: 200 });
  try {
    const job = {
      event_type: 'satisfaction_request', channel: 'whatsapp', source_type: 'customer_experience',
      source_id: experience.id, recipient_phone: '5515999999999', payload: { customer_opt_in: true }
    };
    assert.equal((await __test.verifySatisfactionRequest(job)).ok, true);
    assert.equal((await __test.verifySatisfactionRequest({ ...job, recipient_phone: '5515888888888' })).ok, false);
    assert.equal((await __test.verifySatisfactionRequest({ ...job, payload: { customer_opt_in: false } })).ok, false);
    experience.status = 'awaiting_response';
    assert.equal((await __test.verifySatisfactionRequest(job)).ok, false);
  } finally { restore(previous); }
});

test('review invitation loads current official Google URL only after experience is review_pending', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const experience = {
    id: '11111111-1111-4111-8111-111111111111', status: 'review_pending',
    recipient_phone: '5515999999999', first_name: 'Maria'
  };
  const data = { settings: { reviewUrl: 'https://g.page/r/example/review' } };
  globalThis.fetch = async url => String(url).includes('crm_customer_experience')
    ? new Response(JSON.stringify([experience]), { status: 200 })
    : new Response(JSON.stringify([{ data }]), { status: 200 });
  try {
    const job = {
      event_type: 'review_invitation', channel: 'google_review', source_type: 'customer_experience',
      source_id: experience.id, recipient_phone: '5515999999999', payload: {}
    };
    const ok = await __test.verifyReviewAgainstStoredState(job);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.sendJob.payload.template_parameters, ['Maria', 'https://g.page/r/example/review']);
    assert.equal((await __test.verifyReviewAgainstStoredState({ ...job, recipient_phone: '5515888888888' })).ok, false);
    experience.status = 'recovery_in_progress';
    assert.equal((await __test.verifyReviewAgainstStoredState(job)).ok, false);
  } finally { restore(previous); }
});

test('service recovery processing delegates atomically to recovery RPC', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rpc/prepare_customer_experience_recovery')) return new Response(JSON.stringify({ conflict: false }), { status: 200 });
    if (String(url).includes('/crm_automation_attempts')) return new Response('[]', { status: 201 });
    return new Response('unexpected', { status: 500 });
  };
  try {
    await __test.processJob({
      id: '11111111-1111-4111-8111-111111111111', attempts: 1, max_attempts: 3,
      channel: 'internal', event_type: 'service_recovery_required', source_type: 'customer_experience',
      source_id: '22222222-2222-4222-8222-222222222222', payload: {}
    });
    assert.equal(calls.some(call => call.url.includes('/rpc/prepare_customer_experience_recovery')), true);
    assert.equal(calls.some(call => call.url.includes('graph.facebook.com')), false);
  } finally { restore(previous); }
});

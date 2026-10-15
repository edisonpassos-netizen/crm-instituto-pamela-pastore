import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

const CRM_TEST_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
const CRM_TEST_KEY = 'sb_secret_synthetic';

test('retry delay grows exponentially and is capped', () => {
  assert.equal(__test.retryDelaySeconds(1), 60);
  assert.equal(__test.retryDelaySeconds(2), 120);
  assert.equal(__test.retryDelaySeconds(3), 240);
  assert.equal(__test.retryDelaySeconds(99), 21600);
});

test('review request requires completed attendance, consent, URL and phone', () => {
  const valid = {
    event_type: 'service_completed',
    channel: 'google_review',
    recipient_phone: '5515999999999',
    payload: {
      attendance_status: 'completed',
      customer_opt_in: true,
      google_review_url: 'https://g.page/r/example/review'
    }
  };
  assert.equal(__test.isReviewEligible(valid), true);
  assert.equal(__test.isReviewEligible({ ...valid, payload: { ...valid.payload, attendance_status: 'scheduled' } }), false);
  assert.equal(__test.isReviewEligible({ ...valid, payload: { ...valid.payload, customer_opt_in: false } }), false);
  assert.equal(__test.isReviewEligible({ ...valid, payload: { ...valid.payload, google_review_url: 'javascript:alert(1)' } }), false);
  assert.equal(__test.isReviewEligible({ ...valid, recipient_phone: null }), false);
});

test('review message includes first name and supplied review URL', () => {
  const msg = __test.reviewMessage({
    recipient_phone: '5515999999999',
    payload: { first_name: 'Maria Silva', google_review_url: 'https://g.page/r/example/review' }
  });
  assert.match(msg, /Olá, Maria!/);
  assert.match(msg, /https:\/\/g\.page\/r\/example\/review/);
});
test('unimplemented internal task is not reported as successful', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    await __test.processJob({
      id: 'test-job-id',
      attempts: 1,
      max_attempts: 3,
      channel: 'internal',
      event_type: 'lead_follow_up_requested'
    });
    const attempt = calls.find(call => call.url.includes('crm_automation_attempts'));
    const update = calls.find(call => call.url.includes('crm_automation_queue'));
    assert.equal(attempt.body.outcome, 'failed');
    assert.match(attempt.body.detail, /reconciliador implementado/i);
    assert.equal(update.body.status, 'dead_letter');
    assert.match(update.body.last_error, /reconciliador implementado/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});


test('worker rechecks persisted consent, phone and review URL before send', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const data = {
    attendances: [{ id: 'attendance-42', leadId: 'lead-7', status: 'Concluído', reviewConsent: true, consentAt: '2026-10-12T12:00:00.000Z' }],
    leads: [{ id: 'lead-7', name: 'Maria Silva', phone: '5515999999999' }],
    settings: { reviewUrl: 'https://g.page/r/example/review' }
  };
  globalThis.fetch = async () => new Response(JSON.stringify([{ data }]), { status: 200 });
  try {
    const job = {
      source_id: 'attendance-42', recipient_phone: '5515999999999',
      payload: { attendance_id: 'attendance-42', consent_at: '2026-10-12T12:00:00.000Z', google_review_url: 'https://g.page/r/example/review' }
    };
    assert.equal((await __test.verifyReviewAgainstStoredState(job)).ok, true);
    assert.equal((await __test.verifyReviewAgainstStoredState({ ...job, recipient_phone: '5515888888888' })).ok, false);
    data.attendances[0].reviewConsent = false;
    assert.equal((await __test.verifyReviewAgainstStoredState(job)).ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

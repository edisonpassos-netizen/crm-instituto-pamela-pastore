import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

test('retry delay grows exponentially and is capped', () => {
  assert.equal(__test.retryDelaySeconds(1), 60);
  assert.equal(__test.retryDelaySeconds(2), 120);
  assert.equal(__test.retryDelaySeconds(3), 240);
  assert.equal(__test.retryDelaySeconds(99), 21600);
});

test('review request requires completed attendance, consent, URL and phone', () => {
  const valid = {
    event_type: 'request_review',
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
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
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
    assert.match(attempt.body.detail, /ainda não implementada/i);
    assert.equal(update.body.status, 'dead_letter');
    assert.match(update.body.last_error, /nenhuma ação foi executada/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

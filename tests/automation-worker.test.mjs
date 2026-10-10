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

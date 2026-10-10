import test from 'node:test';
import assert from 'node:assert/strict';

function retryDelaySeconds(attempt) {
  return Math.min(6 * 60 * 60, 60 * (2 ** Math.max(0, attempt - 1)));
}

function isReviewEligible(job) {
  const p = job?.payload || {};
  return job?.event_type === 'request_review'
    && p.attendance_status === 'completed'
    && p.customer_opt_in === true
    && typeof p.google_review_url === 'string'
    && /^https:\/\//i.test(p.google_review_url)
    && Boolean(job.recipient_phone);
}

test('retry delay grows exponentially and is capped', () => {
  assert.equal(retryDelaySeconds(1), 60);
  assert.equal(retryDelaySeconds(2), 120);
  assert.equal(retryDelaySeconds(3), 240);
  assert.equal(retryDelaySeconds(99), 21600);
});

test('review request requires completed attendance, consent, HTTPS URL and phone', () => {
  const valid = {
    event_type: 'request_review',
    recipient_phone: '5515999999999',
    payload: {
      attendance_status: 'completed',
      customer_opt_in: true,
      google_review_url: 'https://g.page/r/example/review'
    }
  };
  assert.equal(isReviewEligible(valid), true);
  assert.equal(isReviewEligible({ ...valid, payload: { ...valid.payload, attendance_status: 'scheduled' } }), false);
  assert.equal(isReviewEligible({ ...valid, payload: { ...valid.payload, customer_opt_in: false } }), false);
  assert.equal(isReviewEligible({ ...valid, payload: { ...valid.payload, google_review_url: 'javascript:alert(1)' } }), false);
  assert.equal(isReviewEligible({ ...valid, recipient_phone: null }), false);
});

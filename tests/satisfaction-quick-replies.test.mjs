import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

test('satisfaction template includes three stable quick-reply payloads in template order', () => {
  const components = __test.templateComponents({
    event_type: 'satisfaction_request',
    payload: { template_parameters: ['Maria', 'Pilates experimental'] }
  });

  assert.deepEqual(components[0], {
    type: 'body',
    parameters: [
      { type: 'text', text: 'Maria' },
      { type: 'text', text: 'Pilates experimental' }
    ]
  });
  assert.deepEqual(components.slice(1), [
    { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'experience_very_good' }] },
    { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'experience_good' }] },
    { type: 'button', sub_type: 'quick_reply', index: '2', parameters: [{ type: 'payload', payload: 'experience_needs_improvement' }] }
  ]);
});

test('review invitation has no satisfaction quick-reply buttons', () => {
  const components = __test.templateComponents({
    event_type: 'review_invitation',
    channel: 'google_review',
    payload: { template_parameters: ['Maria', 'https://g.page/r/example/review'] }
  });
  assert.equal(components.length, 1);
  assert.equal(components[0].type, 'body');
});

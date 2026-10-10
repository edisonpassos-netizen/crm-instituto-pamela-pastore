import test from 'node:test';
import assert from 'node:assert/strict';
import { toAutomationCommand } from '../netlify/functions/lib/automation-event-adapter.mjs';

test('CRM follow-up event becomes a deduplicated internal queue command', () => {
  const command = toAutomationCommand({
    type: 'lead_follow_up_requested',
    sourceType: 'lead',
    sourceId: 'fixture-lead-42',
    occurredAt: '2026-10-10T12:00:00.000Z'
  });
  assert.equal(command.dedupe_key, 'crm:lead_follow_up_requested:lead:fixture-lead-42');
  assert.equal(command.event_type, 'lead_follow_up_requested');
  assert.equal(command.channel, 'internal');
  assert.equal(command.recipient_phone, null);
  assert.equal(command.max_attempts, 3);
});

test('CRM service completion event does not automatically create a review message', () => {
  const command = toAutomationCommand({
    type: 'service_completed',
    sourceType: 'service',
    sourceId: 'fixture-service-5',
    occurredAt: '2026-10-10T12:00:00.000Z'
  });
  assert.equal(command.channel, 'internal');
  assert.equal(command.recipient_phone, null);
  assert.equal('customer_opt_in' in command.payload, false);
});

test('unsupported or incomplete CRM events are rejected', () => {
  assert.throws(() => toAutomationCommand({ type: 'sale_created', sourceType: 'sale', sourceId: '1', occurredAt: '2026-10-10' }), /Unsupported/);
  assert.throws(() => toAutomationCommand({ type: 'service_completed', sourceType: 'service', sourceId: '', occurredAt: '2026-10-10' }), /requires/);
});

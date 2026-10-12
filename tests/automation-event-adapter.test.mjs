import test from 'node:test';
import assert from 'node:assert/strict';
import { toAutomationCommand } from '../netlify/functions/lib/automation-event-adapter.mjs';

test('CRM follow-up event becomes a deduplicated internal queue command', () => {
  const command = toAutomationCommand({
    type: 'lead_follow_up_requested',
    sourceType: 'task',
    sourceId: 'fixture-task-42',
    occurredAt: '2026-10-10T12:00:00.000Z'
  });
  assert.equal(command.dedupe_key, 'crm:lead_follow_up_requested:task:fixture-task-42');
  assert.equal(command.event_type, 'lead_follow_up_requested');
  assert.equal(command.source_type, 'task');
  assert.equal(command.source_id, 'fixture-task-42');
  assert.equal(command.channel, 'internal');
  assert.equal(command.recipient_phone, null);
  assert.equal(command.payload.task, 'follow_up_lead');
  assert.equal(command.max_attempts, 3);
});

test('appointment and service completion events are rejected until real CRM records are implemented', () => {
  for (const type of ['appointment_completed', 'service_completed']) {
    assert.throws(() => toAutomationCommand({
      type, sourceType: 'service', sourceId: 'fixture-service-5',
      occurredAt: '2026-10-10T12:00:00.000Z'
    }), /Unsupported/);
  }
});

test('unsupported events and malformed follow-up sources are rejected', () => {
  assert.throws(() => toAutomationCommand({
    type: 'sale_created', sourceType: 'sale', sourceId: '1',
    occurredAt: '2026-10-10T12:00:00.000Z'
  }), /Unsupported/);
  assert.throws(() => toAutomationCommand({
    type: 'lead_follow_up_requested', sourceType: 'lead', sourceId: '1',
    occurredAt: '2026-10-10T12:00:00.000Z'
  }), /sourceType=task/);
  assert.throws(() => toAutomationCommand({
    type: 'lead_follow_up_requested', sourceType: 'task', sourceId: '',
    occurredAt: '2026-10-10T12:00:00.000Z'
  }), /sourceType=task/);
});

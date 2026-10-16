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

test('service completion becomes a satisfaction request candidate with no client-supplied contact data', () => {
  const command = toAutomationCommand({
    type: 'service_completed', sourceType: 'attendance', sourceId: 'attendance-42',
    occurredAt: '2026-10-10T12:00:00.000Z', recipient_phone: '5515999999999',
    customer_opt_in: true, google_review_url: 'https://evil.example'
  });
  assert.equal(command.dedupe_key, 'crm:satisfaction_request:attendance:attendance-42');
  assert.equal(command.event_type, 'satisfaction_request');
  assert.equal(command.channel, 'whatsapp');
  assert.equal(command.recipient_phone, null);
  assert.deepEqual(command.payload, { attendance_id: 'attendance-42', occurred_at: '2026-10-10T12:00:00.000Z' });
});

test('appointment events and malformed attendance sources are rejected', () => {
  assert.throws(() => toAutomationCommand({
    type: 'appointment_completed', sourceType: 'appointment', sourceId: 'appointment-1',
    occurredAt: '2026-10-10T12:00:00.000Z'
  }), /Unsupported/);
  assert.throws(() => toAutomationCommand({
    type: 'service_completed', sourceType: 'service', sourceId: 'attendance-42',
    occurredAt: '2026-10-10T12:00:00.000Z'
  }), /sourceType=attendance/);
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
  }), /requires sourceId and valid occurredAt/);
});

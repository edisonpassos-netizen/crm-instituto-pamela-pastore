/**
 * Converts only implemented CRM domain events into minimal queue commands.
 * Events are explicit and emitted after a successful CRM save; this adapter
 * never infers events from snapshots and never sends messages.
 */
const ALLOWED_EVENTS = new Set(['lead_follow_up_requested', 'service_completed']);

export function toAutomationCommand(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('CRM event must be an object.');
  }
  if (!ALLOWED_EVENTS.has(event.type)) {
    throw new Error('Unsupported CRM event type.');
  }
  const sourceType = String(event.sourceType || '').trim();
  const sourceId = String(event.sourceId || '').trim();
  const occurredAt = new Date(event.occurredAt || '');
  if (!sourceId || !Number.isFinite(occurredAt.getTime())) {
    throw new Error('CRM event requires sourceId and valid occurredAt.');
  }

  if (event.type === 'lead_follow_up_requested') {
    if (sourceType !== 'task') throw new Error('Follow-up event requires sourceType=task.');
    return {
      dedupe_key: `crm:${event.type}:${sourceType}:${sourceId}`,
      event_type: event.type,
      source_type: sourceType,
      source_id: sourceId,
      recipient_phone: null,
      payload: { source_type: sourceType, source_id: sourceId, occurred_at: occurredAt.toISOString(), task: 'follow_up_lead' },
      channel: 'internal',
      scheduled_at: occurredAt.toISOString(),
      max_attempts: 3
    };
  }

  if (event.type === 'service_completed') {
    if (sourceType !== 'attendance') throw new Error('Service completion event requires sourceType=attendance.');
    // The event is only a request to evaluate server-side eligibility. Contact
    // details, consent and the review URL must be loaded from persisted CRM state.
    return {
      dedupe_key: `crm:service_completed:attendance:${sourceId}`,
      event_type: 'service_completed',
      source_type: 'attendance',
      source_id: sourceId,
      recipient_phone: null,
      payload: { attendance_id: sourceId, occurred_at: occurredAt.toISOString() },
      channel: 'google_review',
      scheduled_at: occurredAt.toISOString(),
      max_attempts: 3
    };
  }
  throw new Error('Unsupported CRM event type.');
}

export const __test = { ALLOWED_EVENTS };

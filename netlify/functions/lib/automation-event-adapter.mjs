/**
 * Converts only implemented CRM domain events into minimal queue commands.
 * Events are explicit and emitted after a successful CRM save; this adapter
 * never infers events from snapshots and never sends messages.
 */
const ALLOWED_EVENTS = new Set(['lead_follow_up_requested']);

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
  if (sourceType !== 'task' || !sourceId || !Number.isFinite(occurredAt.getTime())) {
    throw new Error('Follow-up event requires sourceType=task, sourceId and valid occurredAt.');
  }

  const dedupeKey = `crm:${event.type}:${sourceType}:${sourceId}`;
  return {
    dedupe_key: dedupeKey,
    event_type: event.type,
    source_type: sourceType,
    source_id: sourceId,
    recipient_phone: null,
    payload: {
      source_type: sourceType,
      source_id: sourceId,
      occurred_at: occurredAt.toISOString(),
      task: 'follow_up_lead'
    },
    channel: 'internal',
    scheduled_at: occurredAt.toISOString(),
    max_attempts: 3
  };
}

export const __test = { ALLOWED_EVENTS };

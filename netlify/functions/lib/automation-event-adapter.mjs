/**
 * Converts explicit CRM domain events into a minimal queue command.
 * This adapter does not infer events from a whole-state snapshot and never
 * sends messages. Callers must pass a concrete event after a successful save.
 */
const ALLOWED_EVENTS = new Set([
  'lead_follow_up_requested',
  'appointment_completed',
  'service_completed'
]);

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
  if (!sourceType || !sourceId || !Number.isFinite(occurredAt.getTime())) {
    throw new Error('CRM event requires sourceType, sourceId and valid occurredAt.');
  }

  // Default to an internal task. External messaging is a separate, explicit
  // consent- and eligibility-checked flow and is not enabled by this adapter.
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
      task: event.type === 'lead_follow_up_requested'
        ? 'follow_up_lead'
        : 'confirm_service_record'
    },
    channel: 'internal',
    scheduled_at: occurredAt.toISOString(),
    max_attempts: 3
  };
}

export const __test = { ALLOWED_EVENTS };

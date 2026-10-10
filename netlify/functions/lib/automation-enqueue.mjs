import { toAutomationCommand } from './automation-event-adapter.mjs';

function config() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key || key.startsWith('sb_publishable_')) throw new Error('Supabase server credentials are unavailable.');
  return { base, key };
}

/**
 * Enqueues only explicit, allow-listed domain events supplied alongside a
 * successful CRM state save. Never derives events from JSON snapshots.
 * Client event IDs are echoed back so the caller can safely retain failed items.
 */
export async function enqueueAutomationEvents(events = []) {
  if (!Array.isArray(events) || events.length > 50) throw new Error('automationEvents must be an array of at most 50 items.');
  const { base, key } = config();
  const acceptedEventIds = [];
  const failures = [];
  for (const event of events) {
    const clientEventId = String(event?.clientEventId || '').trim();
    try {
      if (!clientEventId || clientEventId.length > 128) throw new Error('Invalid client event ID.');
      const command = toAutomationCommand(event);
      const response = await fetch(`${base}/rest/v1/rpc/enqueue_crm_automation`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          p_dedupe_key: command.dedupe_key,
          p_event_type: command.event_type,
          p_source_type: command.source_type,
          p_source_id: command.source_id,
          p_recipient_phone: null,
          p_payload: command.payload,
          p_channel: 'internal',
          p_scheduled_at: command.scheduled_at,
          p_max_attempts: command.max_attempts
        })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Queue RPC HTTP ${response.status}: ${text.slice(0, 160)}`);
      acceptedEventIds.push(clientEventId);
    } catch (error) {
      failures.push({ clientEventId: clientEventId || null, message: String(error?.message || 'Enqueue failed').slice(0, 200) });
    }
  }
  return { acceptedEventIds, failures };
}

export const __test = { config };

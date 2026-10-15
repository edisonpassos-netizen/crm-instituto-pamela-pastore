import { createHmac, timingSafeEqual } from 'node:crypto';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function equalText(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function verifySignature(rawBody, supplied, appSecret) {
  if (!supplied || !appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return equalText(expected, supplied);
}
function config() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key || key.startsWith('sb_publishable_')) throw new Error('Webhook server configuration unavailable.');
  return { base, key };
}
async function updateProviderStatus(messageId, status, timestamp, errorInfo = null) {
  const { base, key } = config();
  const query = new URLSearchParams({ provider_message_id: `eq.${messageId}` }).toString();
  const response = await fetch(`${base}/rest/v1/crm_automation_attempts?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify({
      provider_status: status,
      provider_status_at: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : new Date().toISOString(),
      provider_error_code: errorInfo?.code ? String(errorInfo.code).slice(0, 80) : null,
      provider_error_title: errorInfo?.title ? String(errorInfo.title).slice(0, 250) : null
    })
  });
  if (!response.ok) throw new Error(`Status persistence failed (HTTP ${response.status}).`);
  return await response.json().catch(() => []);
}

export default async request => {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
        equalText(token, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    return json(403, { error: 'Webhook verification rejected.' });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET || '')) {
    return json(401, { error: 'Invalid webhook signature.' });
  }
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: 'Invalid JSON payload.' }); }
  const statuses = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const item of change?.value?.statuses || []) {
        if (!item?.id || !['sent', 'delivered', 'read', 'failed'].includes(item.status)) continue;
        const err = Array.isArray(item.errors) ? item.errors[0] : null;
        statuses.push({ id: String(item.id), status: item.status, timestamp: item.timestamp, error: err });
      }
    }
  }
  try {
    let updated = 0, unmatched = 0;
    for (const item of statuses) {
      const rows = await updateProviderStatus(item.id, item.status, item.timestamp, item.error);
      if (rows.length) updated += rows.length;
      else unmatched += 1;
    }
    return json(200, { ok: true, received: statuses.length, updated, unmatched });
  } catch (error) {
    console.error('WhatsApp status webhook persistence failed:', error?.message || 'unknown');
    return json(503, { error: 'Status could not be persisted; provider may retry webhook.' });
  }
};

export const __test = { verifySignature, updateProviderStatus };

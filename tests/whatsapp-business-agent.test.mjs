import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler, { __test } from '../netlify/functions/whatsapp-status-webhook.mjs';

function payload(standby) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'standby', value: {
    metadata: { phone_number_id: '1234567890' }, standby
  } }] }] };
}
const inbound = {
  from: '5515999999999', id: 'wamid.OBSERVER_IN', timestamp: '1793894400',
  type: 'text', text: { body: 'Boa' }
};
const echo = {
  id: 'wamid.OBSERVER_OUT', timestamp: '1793894401', message: {
    to: '5515999999999', type: 'text', text: { body: 'Como posso ajudar?' }
  }
};

async function fixture(bodyPayload, fetchMock, signature = true) {
  const previous = { ...process.env };
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, {
    WHATSAPP_APP_SECRET: 'fixture-secret',
    SUPABASE_URL: 'https://dxfzuxybubvnjertiowf.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic',
    WHATSAPP_LEAD_CAPTURE_ENABLED: 'false', CUSTOMER_EXPERIENCE_ENABLED: 'true'
  });
  globalThis.fetch = fetchMock;
  try {
    const body = JSON.stringify(bodyPayload);
    const headers = signature ? {
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'fixture-secret').update(body).digest('hex')
    } : {};
    return await handler(new Request('https://test.invalid/', { method: 'POST', body, headers }));
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('standby parser keeps customer identity and marks the message passive', () => {
  const messages = __test.extractInboundMessages(payload({
    contacts: [{ wa_id: inbound.from, profile: { name: 'Cliente de teste' } }], messages: [inbound]
  }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].contactName, 'Cliente de teste');
  assert.equal(messages[0].phoneNumberId, '1234567890');
  assert.equal(messages[0].passive, true);
});

test('signed standby inbound and agent echo are stored without surveys, handover or sends', async () => {
  const calls = [];
  const response = await fixture(payload({ messages: [inbound], message_echoes: [echo] }), async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), options, body });
    if (String(url).includes('/rpc/ingest_whatsapp_inbound_message')) {
      return Response.json({ inserted: true });
    }
    if (String(url).includes('/crm_whatsapp_messages?on_conflict=')) {
      return Response.json([{ id: 'echo-row' }]);
    }
    throw new Error('Unexpected network call: ' + url);
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.messagesReceived, 2);
  assert.equal(result.messagesInserted, 2);
  assert.equal(result.experienceResponsesClassified, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.direction, 'outbound');
  assert.equal(calls[1].body.contact_wa_id, inbound.from);
  assert.equal(calls[1].body.provider_message_id, echo.id);
  assert.equal(calls[1].body.text_body, echo.message.text.body);
  assert.equal(calls[1].options.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
});

test('replayed standby messages and echoes retain the existing rows without duplicate effects', async () => {
  const seen = new Set();
  const mock = async (url, options) => {
    const row = JSON.parse(options.body);
    const id = row.p_provider_message_id || row.provider_message_id;
    const inserted = !seen.has(id);
    seen.add(id);
    return String(url).includes('/rpc/')
      ? Response.json({ inserted }) : Response.json(inserted ? [{ id }] : []);
  };
  const p = payload({ messages: [inbound], message_echoes: [echo] });
  assert.equal((await (await fixture(p, mock)).json()).messagesInserted, 2);
  const result = await (await fixture(p, mock)).json();
  assert.equal(result.messagesInserted, 0);
  assert.equal(result.messagesDuplicate, 2);
  assert.equal(seen.size, 2);
});

test('standby payload without signature is rejected before persistence', async () => {
  let calls = 0;
  const response = await fixture(payload({ messages: [inbound], message_echoes: [echo] }), async () => { calls++; }, false);
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('standby echo persistence failure asks Meta to retry instead of discarding the response', async () => {
  const response = await fixture(payload({ message_echoes: [echo] }), async () => new Response('', { status: 503 }));
  assert.equal(response.status, 503);
});

test('standby echo parser excludes missing IDs, invalid recipients and unrelated events', () => {
  assert.equal(__test.extractStandbyEchoes(payload({ message_echoes: [
    { ...echo, id: '' }, { ...echo, message: { ...echo.message, to: 'invalid' } }
  ] })).length, 0);
  const wrong = payload({ message_echoes: [echo] });
  wrong.entry[0].changes[0].field = 'smb_message_echoes';
  assert.equal(__test.extractStandbyEchoes(wrong).length, 0);
});


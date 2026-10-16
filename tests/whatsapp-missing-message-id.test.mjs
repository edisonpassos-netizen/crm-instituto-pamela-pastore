import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

const ENV_KEYS = [
  'WHATSAPP_OUTBOUND_MODE','WHATSAPP_TEST_MODE','WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_GRAPH_API_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANGUAGE','WHATSAPP_TEST_RECIPIENTS'
];

function snapshot() {
  return { fetch: globalThis.fetch, env: Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])) };
}

function restore(previous) {
  globalThis.fetch = previous.fetch;
  for (const key of ENV_KEYS) {
    const value = previous.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test('HTTP 2xx without WhatsApp provider message id becomes delivery_unknown instead of success', async () => {
  const previous = snapshot();
  Object.assign(process.env, {
    WHATSAPP_OUTBOUND_MODE: 'test',
    WHATSAPP_TEST_MODE: 'true',
    WHATSAPP_ACCESS_TOKEN: 'synthetic-test-token',
    WHATSAPP_GRAPH_API_VERSION: 'v26.0',
    WHATSAPP_PHONE_NUMBER_ID: '1275845688956327',
    WHATSAPP_TEMPLATE_NAME: 'hello_world',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
    WHATSAPP_TEST_RECIPIENTS: '5515997601234'
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  try {
    await assert.rejects(
      () => __test.sendWhatsAppTemplate({ recipient_phone: '5515997601234', payload: {} }),
      error => error?.code === 'DELIVERY_UNKNOWN' && /sem identificador/i.test(error.message)
    );
  } finally {
    restore(previous);
  }
});

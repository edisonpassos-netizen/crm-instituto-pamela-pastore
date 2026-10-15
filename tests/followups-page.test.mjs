import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../followups-operacionais.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

test('operator follow-up page has valid inline JavaScript syntax', () => {
  assert.ok(scriptMatch, 'inline script must exist');
  assert.doesNotThrow(() => new Function(scriptMatch[1]));
});

test('operator follow-up page uses authenticated CRM API only', () => {
  assert.match(html, /\.netlify\/functions\/crm-state/);
  assert.match(html, /automation-queue/);
  assert.match(html, /automation-queue-result/);
  assert.match(html, /credentials:'same-origin'/);
  assert.doesNotMatch(html, /supabase\.co/i);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('operator page creates explicit follow-up event together with CRM task', () => {
  assert.match(html, /lead_follow_up_requested/);
  assert.match(html, /automationEvents:\[\{clientEventId/);
  assert.match(html, /sourceType:'task'/);
  assert.match(html, /sourceId:task\.id/);
  assert.match(html, /revision/);
  assert.match(html, /acceptedEventIds/);
});

test('operator follow-up page contains no outbound WhatsApp or Meta call', () => {
  assert.doesNotMatch(html, /graph\.facebook\.com/i);
  assert.doesNotMatch(html, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(html, /Nenhuma mensagem é enviada por esta tela/);
});

test('operator page exposes only allowed manual outcomes and escapes rendered data', () => {
  for (const outcome of ['contacted', 'no_answer', 'rescheduled', 'not_contacted']) {
    assert.match(html, new RegExp(`value=["']${outcome}["']`));
  }
  assert.match(html, /const esc=/);
  assert.doesNotMatch(html, /value=["']send_whatsapp["']/);
});

test('rescheduled result requires a new date and refreshes CRM state after completion', () => {
  assert.match(html, /id="rescheduleDate" type="date"/);
  assert.match(html, /rescheduleDate:rescheduled\?\$\('rescheduleDate'\)\.value:null/);
  assert.match(html, /\$\('rescheduleDate'\)\.required=active/);
  assert.match(html, /Promise\.all\(\[loadCrmState\(\),loadQueue\(\)\]\)/);
  assert.match(html, /novo follow-up será criado/i);
});
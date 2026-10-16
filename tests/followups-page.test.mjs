import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../followups-operacionais.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

test('operator page has valid inline JavaScript syntax', () => {
  assert.ok(scriptMatch, 'inline script must exist');
  assert.doesNotThrow(() => new Function(scriptMatch[1]));
});

test('operator page uses authenticated CRM API only', () => {
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
  assert.match(html, /acceptedEventIds/);
});

test('operator page records date and requested time for new follow-ups', () => {
  assert.match(html, /id="taskDate" type="date" required/);
  assert.match(html, /id="taskTime" type="time" required/);
  assert.match(html, /time:\$\('taskTime'\)\.value/);
  assert.match(html, /data e o horário combinados/i);
});

test('operator page contains no outbound WhatsApp or Meta call', () => {
  assert.doesNotMatch(html, /graph\.facebook\.com/i);
  assert.doesNotMatch(html, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(html, /Nenhuma mensagem é enviada por esta tela/);
});

test('operator page separates follow-up and service recovery outcomes', () => {
  for (const outcome of ['contacted','no_answer','rescheduled','not_contacted','resolved','unresolved']) {
    assert.match(html, new RegExp(`value=["']${outcome}["']`));
  }
  assert.match(html, /service_recovery_required/);
  assert.match(html, /Recuperação de experiência/);
  assert.match(html, /eventType:\$\('eventType'\)\.value/);
  assert.match(html, /Problema tratado \/ experiência recuperada/);
  assert.match(html, /convite neutro de avaliação/i);
  assert.match(html, /const esc=/);
  assert.doesNotMatch(html, /value=["']send_whatsapp["']/);
});

test('rescheduled follow-up requires date and time while recovery reschedule remains date-only', () => {
  assert.match(html, /id="rescheduleDate" type="date"/);
  assert.match(html, /id="rescheduleTime" type="time"/);
  assert.match(html, /\$\('rescheduleDate'\)\.required=active/);
  assert.match(html, /\$\('rescheduleTime'\)\.required=active&&!recovery/);
  assert.match(html, /rescheduleTime:rescheduled&&!recovery\?\$\('rescheduleTime'\)\.value:null/);
  assert.match(html, /Promise\.all\(\[loadCrmState\(\),loadQueue\(\)\]\)/);
});

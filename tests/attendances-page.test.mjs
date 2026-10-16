import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../atendimentos-operacionais.html', import.meta.url), 'utf8');

test('attendance page uses the authenticated CRM API and never calls WhatsApp providers directly', () => {
  assert.match(html, /\/\.netlify\/functions\/crm-state/);
  assert.match(html, /credentials:'same-origin'/);
  assert.doesNotMatch(html, /graph\.facebook\.com/i);
  assert.doesNotMatch(html, /wa\.me\//i);
});

test('attendance completion records explicit consent and emits only the supported service_completed event', () => {
  assert.match(html, /experienceConsent=consent/);
  assert.match(html, /experienceConsentAt=consent\?completedAt:null/);
  assert.match(html, /type:'service_completed'/);
  assert.match(html, /sourceType:'attendance'/);
  assert.match(html, /clientEventId:`service_completed:\$\{next\.id\}`/);
});

test('attendance page can complete without consent and therefore without an automation event', () => {
  assert.match(html, /const events=consent\?\[\{/);
  assert.match(html, /\}\]:\[\]/);
  assert.match(html, /status='Concluído'/);
});

test('attendance page validates phone before recording consent-backed follow-up', () => {
  assert.match(html, /if\(consent&&!validPhone\(lead\.phone\)\)/);
  assert.match(html, /telefone do cliente precisa ser corrigido/i);
});

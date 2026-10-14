import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('user-controlled IDs and phone numbers are not interpolated into inline JavaScript handlers', () => {
  assert.doesNotMatch(html, /on\w+="[^"]*\$\{[^}]+\}[^"]*"/);
  assert.doesNotMatch(html, /onclick="wa\('\$\{l\.phone\}'\)"/);
  assert.match(html, /data-crm-action="wa"/);
  assert.match(html, /data-record-value="\$\{esc\(l\.phone\|\|""\)\}"/);
  assert.match(html, /addEventListener\("click",e=>\{const b=e\.target\.closest\("\[data-crm-action\]"\)/);
});

test('WhatsApp links use noopener and noreferrer', () => {
  assert.match(html, /window\.open\("https:\/\/wa\.me\/"\+p,"_blank","noopener,noreferrer"\)/);
});

test('destructive reset is explicit, guarded, and requires a typed confirmation', () => {
  const fn = html.match(/async function clearData\(\)\{[^\n]*/)?.[0] || '';
  assert.ok(fn, 'clearData function should exist');
  assert.match(fn, /if\(!cloudAvailable\)/);
  assert.match(fn, /digite APAGAR/);
  assert.match(fn, /NUVEM e neste navegador/);
  assert.match(fn, /await saveStore\(\)/);
});

test('backup restore validates schema and limits file size before replacing state', () => {
  const fn = html.match(/async function restore\(\)\{[^\n]*/)?.[0] || '';
  assert.ok(fn, 'restore function should exist');
  assert.match(fn, /f\.size>10\*1024\*1024/);
  assert.match(fn, /x\.version!==1/);
  assert.match(fn, /Array\.isArray\(x\.state\.leads\)/);
  assert.match(fn, /Array\.isArray\(x\.state\.tasks\)/);
  assert.match(fn, /Array\.isArray\(x\.state\.sales\)/);
  assert.match(fn, /x\.state\.settings/);
});

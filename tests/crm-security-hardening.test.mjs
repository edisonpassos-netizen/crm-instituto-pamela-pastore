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
  assert.match(fn, /if\(!cloudAvailable\|\|cloudWarning\)/);
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

test('persistence returns explicit outcomes and reconciles ambiguous remote writes', () => {
  const save = html.match(/async function saveStore\(\)\{[\s\S]*?\n\}\nasync function loadStore\(\)/)?.[0] || '';
  assert.ok(save, 'saveStore should exist');
  assert.match(save, /status:"confirmed"/);
  assert.match(save, /status:"confirmed_reconciled"/);
  assert.match(save, /status:"conflict"/);
  assert.match(save, /status:"unknown"/);
  assert.match(save, /requestCloud\("GET"\)/, 'ambiguous writes should be reconciled by reading remote state');
  assert.match(save, /await saveLocalCache\(snapshot\)/, 'local cache must update after confirmed remote write');
  assert.doesNotMatch(save, /catch\(err\)\{\s*cloudWarning=.*?\n\s*\}/s, 'remote errors must not be silently swallowed');
});

test('lead, sale, import, settings and restore success paths require confirmed persistence', () => {
  assert.match(html, /if\(!saved\.ok\).*?Lead não salvo no servidor/s);
  assert.match(html, /if\(!saved\.ok\).*?Venda não confirmada no servidor/s);
  assert.match(html, /if\(!saved\.ok\).*?Importação não confirmada/s);
  assert.match(html, /if\(!saved\.ok\).*?Configurações não confirmadas no servidor/s);
  assert.match(html, /if\(!saved\.ok\)throw new Error\("A gravação remota não foi confirmada:/);
});

test('recovery does not open WhatsApp before CRM state is confirmed', () => {
  const fn = html.match(/async function recoverLead\(id0\)\{[^\n]*/)?.[0] || '';
  assert.ok(fn, 'recoverLead should exist');
  assert.ok(fn.indexOf('if(!saved.ok)') >= 0);
  assert.ok(fn.indexOf('if(!saved.ok)') < fn.indexOf('wa(l.phone)'));
});

test('destructive reset does not claim success when remote outcome is unknown', () => {
  const fn = html.match(/async function clearData\(\)\{[^\n]*/)?.[0] || '';
  assert.ok(fn, 'clearData should exist');
  assert.match(fn, /const saved=await saveStore\(\)/);
  assert.match(fn, /if\(!saved\.ok\)/);
  assert.match(fn, /Não foi possível confirmar a exclusão/);
});

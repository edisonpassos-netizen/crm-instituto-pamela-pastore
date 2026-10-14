import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const waSource = html.match(/function wa\(phone\)\{[^\n]*\}/)?.[0];

test('WhatsApp helper only opens a mocked wa.me link and never sends a message', () => {
  assert.ok(waSource, 'WhatsApp helper should exist');
  const opened = [];
  const notices = [];
  const context = {
    window: { open: (...args) => opened.push(args) },
    toast: (message) => notices.push(message),
    String
  };
  vm.runInNewContext(waSource, context);
  context.wa('11999998888');
  assert.deepEqual(opened, [['https://wa.me/5511999998888', '_blank', 'noopener,noreferrer']]);
  assert.equal(notices.length, 0);
});

test('WhatsApp helper with missing phone does not open an external destination', () => {
  const opened = [];
  const notices = [];
  const context = {
    window: { open: (...args) => opened.push(args) },
    toast: (message) => notices.push(message),
    String
  };
  vm.runInNewContext(waSource, context);
  context.wa('');
  assert.equal(opened.length, 0);
  assert.deepEqual(notices, ['Telefone não informado']);
});

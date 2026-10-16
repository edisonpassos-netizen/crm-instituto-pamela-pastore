import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../operacao.html',import.meta.url),'utf8');
const inlineScripts=[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);

test('operations dashboard inline JavaScript is syntactically valid',()=>{
  assert.ok(inlineScripts.length>0);
  for(const source of inlineScripts)new Function(source);
});

test('operations dashboard is read-only for queues and has no outbound provider call',()=>{
  assert.match(html,/action=automation-queue|api\('automation-queue'\)/);
  assert.doesNotMatch(html,/graph\.facebook\.com/i);
  assert.doesNotMatch(html,/WHATSAPP_ACCESS_TOKEN/i);
  assert.doesNotMatch(html,/enqueue_crm_automation/i);
});

test('operations dashboard links to the three operational surfaces',()=>{
  assert.match(html,/href="\/"/);
  assert.match(html,/href="\/followups"/);
  assert.match(html,/href="\/atendimentos"/);
});

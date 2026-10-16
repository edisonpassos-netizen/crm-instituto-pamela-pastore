import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/crm-state.mjs';

test('businessRecordCount counts core CRM collections safely', () => {
  assert.equal(__test.businessRecordCount({ leads:[1,2], tasks:[1], sales:[1], attendances:[1,2] }), 6);
  assert.equal(__test.businessRecordCount({}), 0);
  assert.equal(__test.businessRecordCount(null), 0);
});

test('full cloud wipe is detected only when non-empty business state becomes empty', () => {
  const current = { leads:[{id:'1'}], tasks:[{id:'2'}], sales:[], attendances:[] };
  assert.equal(__test.wouldEraseAllBusinessData(current, { leads:[], tasks:[], sales:[], attendances:[] }), true);
  assert.equal(__test.wouldEraseAllBusinessData(current, { leads:[{id:'1'}], tasks:[], sales:[], attendances:[] }), false);
  assert.equal(__test.wouldEraseAllBusinessData({ leads:[], tasks:[], sales:[] }, { leads:[], tasks:[], sales:[] }), false);
});

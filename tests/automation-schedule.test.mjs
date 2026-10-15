import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../netlify/functions/automation-worker.mjs';

test('automation worker uses a five-minute production cadence', () => {
  assert.deepEqual(config, { schedule: '*/5 * * * *' });
});

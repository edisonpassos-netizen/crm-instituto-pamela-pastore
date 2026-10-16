import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFollowUpDueAt,
  validFollowUpTime,
  zonedDateTimeToUtc
} from '../netlify/functions/lib/followup-schedule.mjs';

test('date-only follow-ups preserve the historical noon UTC scheduling behavior', () => {
  assert.equal(
    resolveFollowUpDueAt({ date: '2026-10-17' }).toISOString(),
    '2026-10-17T12:00:00.000Z'
  );
});

test('follow-up date and time are converted from the Institute timezone to UTC', () => {
  assert.equal(
    zonedDateTimeToUtc('2026-10-17', '09:30', 'America/Sao_Paulo').toISOString(),
    '2026-10-17T12:30:00.000Z'
  );
  assert.equal(
    resolveFollowUpDueAt(
      { date: '2026-10-17', time: '17:45' },
      { CRM_BUSINESS_TIME_ZONE: 'America/Sao_Paulo' }
    ).toISOString(),
    '2026-10-17T20:45:00.000Z'
  );
});

test('invalid calendar dates, times and timezone names fail closed', () => {
  assert.throws(() => zonedDateTimeToUtc('2026-02-30', '10:00', 'America/Sao_Paulo'), /Data/);
  assert.throws(() => zonedDateTimeToUtc('2026-10-17', '25:00', 'America/Sao_Paulo'), /Horário/);
  assert.throws(() => zonedDateTimeToUtc('2026-10-17', '10:00', 'Invalid\/Zone'));
  assert.equal(validFollowUpTime('09:05'), true);
  assert.equal(validFollowUpTime(''), true);
  assert.equal(validFollowUpTime('9:05'), false);
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

function validCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year
    && check.getUTCMonth() === month - 1
    && check.getUTCDate() === day;
}

function formatterFor(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function timeZoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(instant)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - instant.getTime();
}

export function zonedDateTimeToUtc(dateText, timeText, timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const date = String(dateText || '').trim();
  const time = String(timeText || '').trim();
  const zone = String(timeZone || DEFAULT_BUSINESS_TIME_ZONE).trim() || DEFAULT_BUSINESS_TIME_ZONE;
  if (!validCalendarDate(date)) throw new Error('Data de follow-up inválida.');
  if (!TIME_RE.test(time)) throw new Error('Horário de follow-up inválido.');

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // Two passes handle timezone offset transitions without introducing a
  // third-party dependency. Intl validates the configured IANA timezone.
  let candidate = new Date(localAsUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = timeZoneOffsetMs(candidate, zone);
    candidate = new Date(localAsUtc - offset);
  }

  return candidate;
}

export function resolveFollowUpDueAt(task, env = process.env) {
  const date = String(task?.date || '').trim();
  if (!validCalendarDate(date)) throw new Error('Data de follow-up inválida.');

  const time = String(task?.time || '').trim();
  if (!time) {
    // Preserve the historical behavior for existing date-only tasks.
    return new Date(`${date}T12:00:00.000Z`);
  }

  const timeZone = String(env?.CRM_BUSINESS_TIME_ZONE || DEFAULT_BUSINESS_TIME_ZONE).trim()
    || DEFAULT_BUSINESS_TIME_ZONE;
  return zonedDateTimeToUtc(date, time, timeZone);
}

export function validFollowUpTime(value) {
  const time = String(value || '').trim();
  return !time || TIME_RE.test(time);
}

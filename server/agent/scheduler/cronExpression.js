const FIELD_SPECS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

function normalizeDow(value) {
  return value === 7 ? 0 : value;
}

function parsePart(part, spec) {
  if (!part) return { error: `${spec.name} field contains an empty segment` };

  const stepMatch = part.match(/^(.+)\/(\d+)$/);
  const base = stepMatch ? stepMatch[1] : part;
  const step = stepMatch ? Number(stepMatch[2]) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    return { error: `${spec.name} step must be a positive integer` };
  }

  let start;
  let end;
  if (base === '*') {
    start = spec.min;
    end = spec.max;
  } else if (/^\d+$/.test(base)) {
    start = Number(base);
    end = start;
  } else {
    const range = base.match(/^(\d+)-(\d+)$/);
    if (!range) return { error: `${spec.name} field has invalid segment "${part}"` };
    start = Number(range[1]);
    end = Number(range[2]);
  }

  if (start < spec.min || start > spec.max || end < spec.min || end > spec.max) {
    return { error: `${spec.name} value must be between ${spec.min} and ${spec.max}` };
  }
  if (start > end) {
    return { error: `${spec.name} range start must be less than or equal to range end` };
  }

  const values = new Set();
  for (let value = start; value <= end; value += step) {
    values.add(spec.name === 'day of week' ? normalizeDow(value) : value);
  }
  return { values };
}

function parseField(field, spec) {
  const values = new Set();
  for (const part of String(field).split(',')) {
    const parsed = parsePart(part.trim(), spec);
    if (parsed.error) return parsed;
    for (const value of parsed.values) values.add(value);
  }
  return { values };
}

function parseCron(cron) {
  const fields = String(cron || '').trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    return { error: 'Cron expression must contain five fields: minute hour day-of-month month day-of-week' };
  }

  const parsed = fields.map((field, index) => parseField(field, FIELD_SPECS[index]));
  const invalid = parsed.find(result => result.error);
  if (invalid) return invalid;

  return {
    fields,
    minute: parsed[0].values,
    hour: parsed[1].values,
    dayOfMonth: parsed[2].values,
    month: parsed[3].values,
    dayOfWeek: parsed[4].values,
  };
}

export function validateCron(cron) {
  return parseCron(cron).error || null;
}

export function cronMatches(cron, date) {
  const parsed = parseCron(cron);
  if (parsed.error || !(date instanceof Date) || Number.isNaN(date.getTime())) return false;

  const cronDow = normalizeDow(date.getDay());
  const minuteOk = parsed.minute.has(date.getMinutes());
  const hourOk = parsed.hour.has(date.getHours());
  const monthOk = parsed.month.has(date.getMonth() + 1);
  if (!minuteOk || !hourOk || !monthOk) return false;

  const domOk = parsed.dayOfMonth.has(date.getDate());
  const dowOk = parsed.dayOfWeek.has(cronDow);
  const domUnconstrained = parsed.fields[2] === '*';
  const dowUnconstrained = parsed.fields[4] === '*';

  if (domUnconstrained && dowUnconstrained) return true;
  if (domUnconstrained) return dowOk;
  if (dowUnconstrained) return domOk;
  return domOk || dowOk;
}

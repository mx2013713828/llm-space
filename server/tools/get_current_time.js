function getDateTimeParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function buildCurrentTime({
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
} = {}) {
  const parts = getDateTimeParts(now, timeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    timezone: timeZone,
    iso: now.toISOString(),
  };
}

export default {
  name: 'get_current_time',
  description: 'Get the exact current date and time in the system timezone. Use this when a task depends on the current clock time rather than only the current date.',
  parameters: {},
  async execute() {
    return JSON.stringify(buildCurrentTime(), null, 2);
  },
};

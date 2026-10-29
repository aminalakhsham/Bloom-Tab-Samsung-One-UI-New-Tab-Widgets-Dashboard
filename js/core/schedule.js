// chrome.alarms helpers shared by the pages and the background worker.
// Alarm names: 'timer:<id>', 'alarm:<id>', 'reminder:<id>', 'event:<id>'.
// The background worker turns a fired alarm into a system notification + an entry in `notifications`.

const hasAlarms = () => !!globalThis.chrome?.alarms;

export function scheduleAt(name, when) {
  if (!hasAlarms()) return;
  if (!when || when <= Date.now()) return chrome.alarms.clear(name);
  chrome.alarms.create(name, { when });
}

export function cancelSchedule(name) {
  if (hasAlarms()) chrome.alarms.clear(name);
}

/**
 * Next time a clock alarm { time: 'HH:MM', days: [0..6] (Sun=0; empty = once), date?: 'YYYY-MM-DD' } rings, in ms.
 * A one-time alarm with a `date` (Samsung Clock's calendar button) rings on that day only (null once it has passed).
 */
export function nextAlarmTime(alarm, from = Date.now()) {
  const [hh, mm] = String(alarm.time || '07:00').split(':').map(Number);
  const dm = !alarm.days?.length && /^(\d{4})-(\d\d)-(\d\d)$/.exec(alarm.date || '');
  if (dm) {
    const at = new Date(+dm[1], +dm[2] - 1, +dm[3], hh, mm, 0, 0).getTime();
    return at > from ? at : null;
  }
  const base = new Date(from);
  for (let i = 0; i < 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0);
    if (d.getTime() <= from) continue;
    if (!alarm.days?.length || alarm.days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

/** (Re)schedule a clock alarm. */
export function scheduleAlarm(alarm) {
  const name = 'alarm:' + alarm.id;
  if (!alarm.enabled) return cancelSchedule(name);
  scheduleAt(name, nextAlarmTime(alarm));
}

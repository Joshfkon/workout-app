import {
  DEFAULT_TRACKING_REMINDERS,
  addDays,
  computeTrackingStatus,
  daysBetween,
  dueTrackingItems,
  nextNotifyDate,
  planTrackingReminders,
  readTrackingReminderSettings,
  trackingItemDetail,
  trackingNudgeTitle,
  trackingReminderIds,
  trackingReminderPreferencesPatch,
  TRACKING_REMINDER_ID_BASE,
  WORKOUT_REMINDER_ID_BASE,
  type TrackingReminderSettings,
  type TrackingStatus,
} from '../trackingReminders';

const TODAY = '2026-11-24';
const NOW = new Date(2026, 10, 24, 6, 0); // 06:00 local on TODAY

const settings = (patch: Partial<TrackingReminderSettings> = {}): TrackingReminderSettings => ({
  ...DEFAULT_TRACKING_REMINDERS,
  ...patch,
  cadenceDays: { ...DEFAULT_TRACKING_REMINDERS.cadenceDays, ...(patch.cadenceDays ?? {}) },
});

const status = (
  last: Partial<Record<'weigh' | 'measure' | 'photo', string | null>>,
  opts: { accountCreated?: string | null; s?: TrackingReminderSettings } = {}
) =>
  computeTrackingStatus({
    settings: opts.s ?? settings(),
    lastLogged: { weigh: null, measure: null, photo: null, ...last },
    accountCreated: opts.accountCreated === undefined ? '2026-01-01' : opts.accountCreated,
    today: TODAY,
  });

describe('date helpers', () => {
  it('adds calendar days across month, year and DST boundaries', () => {
    expect(addDays('2026-11-24', 7)).toBe('2026-12-01');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-24', '2026-11-20')).toBe(-4);
  });
});

describe('readTrackingReminderSettings', () => {
  it('defaults: weigh 7d, measure 4w, photos 4w; notifications off', () => {
    const s = readTrackingReminderSettings(null);
    expect(s.cadenceDays).toEqual({ weigh: 7, measure: 28, photo: 28 });
    expect(s.notify).toBe(false);
    expect(s.workoutNotify).toBe(false);
  });

  it('reads the measurement cadence from the Body hub setting (weeks), 0 = off', () => {
    expect(readTrackingReminderSettings({ measurementNudgeWeeks: 6 }).cadenceDays.measure).toBe(42);
    expect(readTrackingReminderSettings({ measurementNudgeWeeks: 0 }).cadenceDays.measure).toBe(0);
  });

  it('ignores junk values', () => {
    const s = readTrackingReminderSettings({
      trackingReminders: { weighInDays: -3, photoDays: 'x', notify: 'yes', notifyTime: '25:00' },
    });
    expect(s.cadenceDays.weigh).toBe(7);
    expect(s.cadenceDays.photo).toBe(28);
    expect(s.notify).toBe(false);
    expect(s.notifyTime).toBe(DEFAULT_TRACKING_REMINDERS.notifyTime);
  });

  it('round-trips through the preferences patch', () => {
    const s = settings({ cadenceDays: { weigh: 1, measure: 14, photo: 0 }, notify: true, notifyTime: '06:45' });
    const patch = trackingReminderPreferencesPatch(s);
    expect(patch.measurementNudgeWeeks).toBe(2);
    expect(readTrackingReminderSettings(patch)).toEqual(s);
  });
});

describe('computeTrackingStatus', () => {
  it('is due once the last entry is at least the cadence old', () => {
    const [weigh, measure, photo] = status({
      weigh: '2026-11-17', // 7 days → due today
      measure: '2026-11-10', // 14 days of 28 → not due
      photo: '2026-10-01', // 54 days → overdue
    });
    expect(weigh).toMatchObject({ kind: 'weigh', isDue: true, dueDate: TODAY, daysSinceLast: 7 });
    expect(measure).toMatchObject({ kind: 'measure', isDue: false, dueDate: '2026-12-08' });
    expect(photo).toMatchObject({ kind: 'photo', isDue: true, daysSinceLast: 54 });
  });

  it('never-logged items wait a week after sign-up', () => {
    const fresh = status({}, { accountCreated: '2026-11-20' });
    expect(fresh.every((s) => !s.isDue)).toBe(true);
    expect(fresh[0].dueDate).toBe('2026-11-27');
    const older = status({}, { accountCreated: '2026-11-17' });
    expect(older.every((s) => s.isDue && s.daysSinceLast === null)).toBe(true);
  });

  it('drops items whose cadence is off', () => {
    const s = settings({ cadenceDays: { weigh: 0, measure: 28, photo: 0 } });
    expect(status({}, { s }).map((x) => x.kind)).toEqual(['measure']);
  });
});

describe('dueTrackingItems', () => {
  it('hides snoozed items until the snooze date', () => {
    const all = status({});
    expect(dueTrackingItems(all, TODAY).length).toBe(3);
    const snoozed = dueTrackingItems(all, TODAY, { weigh: '2026-11-30', photo: TODAY });
    expect(snoozed.map((s) => s.kind)).toEqual(['measure', 'photo']);
  });
});

describe('copy', () => {
  const items = status({ weigh: '2026-11-10', photo: null });
  it('titles one item or lists several', () => {
    expect(trackingNudgeTitle([items[0]])).toBe('Time to weigh in');
    expect(trackingNudgeTitle(items)).toBe('Due: weigh-in, measurements and progress photos');
  });
  it('says when each was last logged', () => {
    expect(trackingItemDetail(items[0])).toBe('Last weigh-in 2 weeks ago');
    expect(trackingItemDetail({ ...items[0], daysSinceLast: 1 })).toBe('Last weigh-in 1 day ago');
    expect(trackingItemDetail(items[1])).toBe('No measurements logged yet');
  });
});

describe('nextNotifyDate', () => {
  it('fires on the due date, then weekly while overdue', () => {
    expect(nextNotifyDate('2026-11-30', TODAY)).toBe('2026-11-30');
    expect(nextNotifyDate(TODAY, TODAY)).toBe(TODAY);
    expect(nextNotifyDate('2026-11-23', TODAY)).toBe('2026-11-30');
    expect(nextNotifyDate('2026-11-17', TODAY)).toBe(TODAY);
    expect(nextNotifyDate('2026-11-20', TODAY, 1)).toBe(TODAY);
  });

  it('a daily weigh-in that is overdue notifies every day of the window', () => {
    const s = settings({ notify: true, cadenceDays: { weigh: 1, measure: 0, photo: 0 } });
    const planned = planTrackingReminders({
      settings: s,
      statuses: status({ weigh: '2026-11-20' }, { s }),
      trainingDays: [],
      trainedToday: false,
      now: NOW,
      today: TODAY,
    });
    expect(planned).toHaveLength(7);
  });
});

describe('planTrackingReminders', () => {
  const base = {
    trainingDays: [],
    trainedToday: false,
    now: NOW,
    today: TODAY,
  };

  it('plans nothing while notifications are off', () => {
    expect(planTrackingReminders({ ...base, settings: settings(), statuses: status({}) })).toEqual([]);
  });

  it('combines items notifying the same day into one notification', () => {
    const s = settings({ notify: true, notifyTime: '07:30' });
    const planned = planTrackingReminders({
      ...base,
      settings: s,
      statuses: status({ weigh: '2026-11-17', measure: '2026-10-27', photo: '2026-11-03' }, { s }),
    });
    // weigh due today, measure due today (28d), photo due Dec 1 (outside 7 days? no: Dec 1 is day 7)
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      id: TRACKING_REMINDER_ID_BASE,
      title: 'Progress check-in',
      body: expect.stringContaining('Weigh-in and measurements are due'),
    });
    expect(planned[0].fireAt).toEqual(new Date(2026, 10, 24, 7, 30));
  });

  it('a lone photo reminder opens the add-photo screen', () => {
    const s = settings({ notify: true, cadenceDays: { weigh: 0, measure: 0, photo: 28 } });
    const planned = planTrackingReminders({ ...base, settings: s, statuses: status({ photo: '2026-10-29' }, { s }) });
    expect(planned).toHaveLength(1);
    expect(planned[0].fireAt).toEqual(new Date(2026, 10, 26, 7, 30));
    expect(planned[0].url).toBe('/dashboard/progress-photos?add=1');
  });

  it('skips a time already past today', () => {
    const s = settings({ notify: true, notifyTime: '05:00', cadenceDays: { weigh: 7, measure: 0, photo: 0 } });
    const planned = planTrackingReminders({ ...base, settings: s, statuses: status({ weigh: '2026-11-17' }, { s }) });
    // Due today but 05:00 has passed; the weekly repeat lands outside the window.
    expect(planned).toEqual([]);
  });

  it('workout reminders: one per scheduled date in the window, skipping today once trained', () => {
    const s = settings({ workoutNotify: true, workoutTime: '17:00' });
    const trainingDays = [
      { date: TODAY, label: 'Push' },
      { date: '2026-11-26', label: 'Pull' },
      { date: '2026-11-28' },
      { date: '2026-12-05', label: 'Legs' }, // outside 7 days
    ];
    const planned = planTrackingReminders({ ...base, settings: s, statuses: [], trainingDays });
    expect(planned.map((p) => p.body)).toEqual([
      'Push is on the plan today.',
      'Pull is on the plan today.',
      'A workout is on the plan today.',
    ]);
    expect(planned.map((p) => p.id)).toEqual([0, 1, 2].map((i) => WORKOUT_REMINDER_ID_BASE + i));

    const trained = planTrackingReminders({ ...base, settings: s, statuses: [], trainingDays, trainedToday: true });
    expect(trained.map((p) => p.body)[0]).toBe('Pull is on the plan today.');
  });

  it('collapses a two-a-day date into one workout reminder', () => {
    const s = settings({ workoutNotify: true });
    const planned = planTrackingReminders({
      ...base,
      settings: s,
      statuses: [],
      trainingDays: [{ date: TODAY }, { date: TODAY }],
    });
    expect(planned).toHaveLength(1);
  });

  it('every planned id is in the cleared range', () => {
    const ids = new Set(trackingReminderIds());
    const s = settings({ notify: true, workoutNotify: true, cadenceDays: { weigh: 1, measure: 0, photo: 0 } });
    const planned = planTrackingReminders({
      ...base,
      settings: s,
      statuses: status({ weigh: '2026-11-23' }, { s }) as TrackingStatus[],
      trainingDays: Array.from({ length: 7 }, (_, i) => ({ date: addDays(TODAY, i) })),
    });
    expect(planned.length).toBeGreaterThan(0);
    for (const p of planned) expect(ids.has(p.id)).toBe(true);
  });
});

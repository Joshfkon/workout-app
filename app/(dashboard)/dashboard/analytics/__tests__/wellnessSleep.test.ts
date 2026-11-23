import { mergeSleepLogIntoWellness, type WellnessDay } from '../wellnessSleep';

const day = (date: string, over: Partial<WellnessDay> = {}): WellnessDay => ({
  date,
  sleepHours: null,
  sleepQuality: null,
  energyLevel: null,
  moodRating: null,
  focusRating: null,
  libidoRating: null,
  stressLevel: null,
  sorenessLevel: null,
  hungerLevel: null,
  ...over,
});

describe('mergeSleepLogIntoWellness', () => {
  it('adds quick-logged / Apple Health nights that have no check-in', () => {
    const out = mergeSleepLogIntoWellness([day('2026-11-20', { energyLevel: 4 })], [
      { local_day: '2026-11-22', hours: 7.5, quality: 'good' },
      { local_day: '2026-11-21', hours: '6', quality: 'poor' },
    ]);
    expect(out.map((d) => [d.date, d.sleepHours, d.sleepQuality])).toEqual([
      ['2026-11-20', null, null],
      ['2026-11-21', 6, 2],
      ['2026-11-22', 7.5, 4],
    ]);
    expect(out[0].energyLevel).toBe(4);
  });

  it('a sleep_log night wins over the check-in copy and keeps the rest of the check-in', () => {
    const out = mergeSleepLogIntoWellness(
      [day('2026-11-22', { sleepHours: 6, sleepQuality: 2, moodRating: 5 })],
      [{ local_day: '2026-11-22', hours: 8, quality: 'ok' }]
    );
    expect(out).toEqual([day('2026-11-22', { sleepHours: 8, sleepQuality: 3, moodRating: 5 })]);
  });

  it('keeps a 0-hour night (an all-nighter), including over a check-in copy', () => {
    const out = mergeSleepLogIntoWellness([day('2026-11-22', { sleepHours: 7, sleepQuality: 4 })], [
      { local_day: '2026-11-22', hours: 0, quality: 'poor' },
      { local_day: '2026-11-21', hours: '0', quality: 'poor' },
    ]);
    expect(out.map((d) => [d.date, d.sleepHours, d.sleepQuality])).toEqual([
      ['2026-11-21', 0, 2],
      ['2026-11-22', 0, 2],
    ]);
  });

  it('skips missing, non-numeric or negative hours and leaves days untouched without sleep_log', () => {
    const days = [day('2026-11-22', { sleepHours: 7, sleepQuality: 4 })];
    expect(
      mergeSleepLogIntoWellness(days, [
        { local_day: '2026-11-21', hours: null, quality: 'ok' },
        { local_day: '2026-11-20', hours: 'abc', quality: 'ok' },
        { local_day: '2026-11-19', hours: -1, quality: 'ok' },
      ])
    ).toEqual(days);
    expect(mergeSleepLogIntoWellness(days, [])).toEqual(days);
  });
});

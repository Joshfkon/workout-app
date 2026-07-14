import {
  aggregateSleepSamples,
  selectWritableSleepDays,
  type SleepSampleInput,
} from '@/services/healthkitSleep';
import { getLocalDateString } from '@/lib/utils';

/** Expected check-in day for a sample: local day of (midpoint + 12h). */
function expectedDay(startIso: string, endIso: string): string {
  const midpoint = (Date.parse(startIso) + Date.parse(endIso)) / 2;
  return getLocalDateString(new Date(midpoint + 12 * 3_600_000));
}

const watch = { sourceName: 'Apple Watch', sourceId: 'com.apple.watch' };
const garmin = { sourceName: 'Garmin Connect', sourceId: 'com.garmin.connect' };
const iphone = { sourceName: 'iPhone', sourceId: 'com.apple.health' };

describe('aggregateSleepSamples', () => {
  it('aggregates a fragmented staged night into merged asleep hours', () => {
    const samples: SleepSampleInput[] = [
      // 23:00–00:30 light (1.5h)
      { startDate: '2026-07-11T23:00:00Z', endDate: '2026-07-12T00:30:00Z', sleepState: 'light', ...watch },
      // awake gap — never counted
      { startDate: '2026-07-12T00:30:00Z', endDate: '2026-07-12T01:00:00Z', sleepState: 'awake', ...watch },
      // 01:00–03:00 deep
      { startDate: '2026-07-12T01:00:00Z', endDate: '2026-07-12T03:00:00Z', sleepState: 'deep', ...watch },
      // 02:30–04:00 rem OVERLAPS deep by 30min — merged, not summed
      { startDate: '2026-07-12T02:30:00Z', endDate: '2026-07-12T04:00:00Z', sleepState: 'rem', ...watch },
      // 04:00–06:30 light
      { startDate: '2026-07-12T04:00:00Z', endDate: '2026-07-12T06:30:00Z', sleepState: 'light', ...watch },
    ];

    const nights = aggregateSleepSamples(samples);
    expect(nights).toHaveLength(1);
    // 1.5h + merged(01:00–06:30 = 5.5h) = 7.0h — the 30min overlap counted once
    expect(nights[0].hours).toBe(7);
    expect(nights[0].staged).toBe(true);
    expect(nights[0].sourceName).toBe('Apple Watch');
    expect(nights[0].localDay).toBe(
      expectedDay('2026-07-11T23:00:00Z', '2026-07-12T06:30:00Z')
    );
  });

  it('prefers the staged source over inferred-asleep and in-bed-only sources, never summing across sources', () => {
    const samples: SleepSampleInput[] = [
      // Watch: staged, 7h (23:00–06:00)
      { startDate: '2026-07-11T23:00:00Z', endDate: '2026-07-12T03:00:00Z', sleepState: 'deep', ...watch },
      { startDate: '2026-07-12T03:00:00Z', endDate: '2026-07-12T06:00:00Z', sleepState: 'light', ...watch },
      // Garmin: plain asleep, longer (8h) — still loses to stages
      { startDate: '2026-07-11T22:30:00Z', endDate: '2026-07-12T06:30:00Z', sleepState: 'asleep', ...garmin },
      // iPhone: in-bed only, 9h — lowest quality
      { startDate: '2026-07-11T22:00:00Z', endDate: '2026-07-12T07:00:00Z', sleepState: 'inBed', ...iphone },
    ];

    const nights = aggregateSleepSamples(samples);
    expect(nights).toHaveLength(1);
    expect(nights[0].sourceName).toBe('Apple Watch');
    expect(nights[0].hours).toBe(7); // not 7+8+9
    expect(nights[0].staged).toBe(true);
  });

  it('falls back to in-bed intervals when a night has no asleep-stage source', () => {
    const nights = aggregateSleepSamples([
      { startDate: '2026-07-11T23:00:00Z', endDate: '2026-07-12T07:00:00Z', sleepState: 'inBed', ...iphone },
    ]);
    expect(nights).toHaveLength(1);
    expect(nights[0].hours).toBe(8);
    expect(nights[0].staged).toBe(false);
  });

  it('assigns evening and morning fragments of one night to the same local day, and separate nights to separate days', () => {
    const nightOne: SleepSampleInput[] = [
      { startDate: '2026-07-11T22:00:00Z', endDate: '2026-07-11T23:30:00Z', sleepState: 'asleep', ...garmin },
      { startDate: '2026-07-12T00:00:00Z', endDate: '2026-07-12T06:00:00Z', sleepState: 'asleep', ...garmin },
    ];
    const nightTwo: SleepSampleInput[] = [
      { startDate: '2026-07-12T23:00:00Z', endDate: '2026-07-13T06:30:00Z', sleepState: 'asleep', ...garmin },
    ];

    const nights = aggregateSleepSamples([...nightOne, ...nightTwo]);
    expect(nights).toHaveLength(2);
    expect(nights[0].hours).toBe(7.5); // 1.5 + 6, gap not bridged into hours
    expect(nights[1].hours).toBe(7.5);
    expect(nights[0].localDay).not.toBe(nights[1].localDay);
  });

  it('drops junk data: invalid ranges, sub-30-minute "nights", and >16h monsters', () => {
    const nights = aggregateSleepSamples([
      // end before start
      { startDate: '2026-07-12T06:00:00Z', endDate: '2026-07-12T05:00:00Z', sleepState: 'asleep', ...watch },
      // 10-minute nap night
      { startDate: '2026-07-12T02:00:00Z', endDate: '2026-07-12T02:10:00Z', sleepState: 'asleep', ...garmin },
      // 20-hour "night"
      { startDate: '2026-07-10T20:00:00Z', endDate: '2026-07-11T16:00:00Z', sleepState: 'asleep', ...iphone },
    ]);
    expect(nights).toHaveLength(0);
  });
});

describe('selectWritableSleepDays (manual entry always wins)', () => {
  const days = [
    { date: '2026-07-11', hours: 7.2 },
    { date: '2026-07-12', hours: 6.8 },
    { date: '2026-07-13', hours: 8.1 },
  ];

  it('skips days with a manual sleep_log row, overwrites prior imports, fills empty days', () => {
    const writable = selectWritableSleepDays(days, [
      { localDay: '2026-07-11', source: 'manual' }, // user-entered — untouchable
      { localDay: '2026-07-12', source: 'healthkit' }, // own import — updatable
      // 2026-07-13 has no row — writable
    ]);
    expect(writable.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-13']);
  });

  it('treats rows with an unknown/missing source as manual (defensive)', () => {
    const writable = selectWritableSleepDays(days, [
      { localDay: '2026-07-11', source: null },
    ]);
    expect(writable.map((d) => d.date)).toEqual(['2026-07-12', '2026-07-13']);
  });

  it('drops junk hours instead of writing them', () => {
    const writable = selectWritableSleepDays(
      [
        { date: '2026-07-11', hours: 0 },
        { date: '2026-07-12', hours: 25 },
        { date: '2026-07-13', hours: 8 },
      ],
      []
    );
    expect(writable.map((d) => d.date)).toEqual(['2026-07-13']);
  });
});

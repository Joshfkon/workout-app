import { latestWellnessReading } from '../healthGlance';
import type { WellnessDay } from '../wearableRecovery';

const day = (date: string, hrvSdnnMs: number | null, restingHrBpm: number | null = null): WellnessDay => ({
  date,
  hrvSdnnMs,
  restingHrBpm,
});

// Nov 1-10 at 50 ms, then 40 ms on Nov 11.
const history: WellnessDay[] = [
  ...Array.from({ length: 10 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, '0')}`, 50, 60)),
  day('2026-11-11', 40, 66),
];

describe('latestWellnessReading', () => {
  it('reports the newest HRV against the 14-day median before it', () => {
    expect(latestWellnessReading(history, 'hrvSdnnMs')).toEqual({
      value: 40,
      date: '2026-11-11',
      baseline: 50,
      deltaPct: -20,
    });
  });

  it('works for resting heart rate too', () => {
    expect(latestWellnessReading(history, 'restingHrBpm')).toMatchObject({ value: 66, deltaPct: 10 });
  });

  it('skips days without that metric', () => {
    const withGap = [...history, day('2026-11-12', null, 61)];
    expect(latestWellnessReading(withGap, 'hrvSdnnMs')).toMatchObject({ date: '2026-11-11' });
  });

  it('has no baseline with too little history', () => {
    expect(latestWellnessReading([day('2026-11-01', 50), day('2026-11-02', 45)], 'hrvSdnnMs')).toEqual({
      value: 45,
      date: '2026-11-02',
      baseline: null,
      deltaPct: null,
    });
  });

  it('is null without any reading', () => {
    expect(latestWellnessReading([], 'hrvSdnnMs')).toBeNull();
    expect(latestWellnessReading([day('2026-11-01', null)], 'hrvSdnnMs')).toBeNull();
  });
});

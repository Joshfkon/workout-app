import { calculateFatigueScore, checkDeloadTriggers } from '@/services/deloadEngine';
import type {
  WeeklyPerformanceData,
  ExtendedUserProfile,
  PeriodizationPlan,
} from '@/types/schema';

const healthyWeek = (weekNumber: number): WeeklyPerformanceData => ({
  weekNumber,
  missedReps: 0,
  perceivedFatigue: 2,
  sleepQuality: 4,
  motivationLevel: 4,
  jointPain: false,
  strengthDecline: false,
});

const profile = { experience: 'intermediate' } as ExtendedUserProfile;
const periodization = { deloadFrequency: 5 } as PeriodizationPlan;

describe('calculateFatigueScore — wearable contribution', () => {
  it('adds the small capped contribution for a sustained deviation streak', () => {
    const base = calculateFatigueScore(healthyWeek(1));
    const withStreak = calculateFatigueScore({
      ...healthyWeek(1),
      wearableDeviationDays: 7,
    });
    expect(withStreak - base).toBe(7); // 5 onset + 2 extra days

    const capped = calculateFatigueScore({
      ...healthyWeek(1),
      wearableDeviationDays: 30,
    });
    expect(capped - base).toBe(8); // hard cap
  });

  it('contributes nothing below the sustained threshold', () => {
    const base = calculateFatigueScore(healthyWeek(1));
    expect(
      calculateFatigueScore({ ...healthyWeek(1), wearableDeviationDays: 4 })
    ).toBe(base);
  });
});

describe('checkDeloadTriggers — wearable evidence is supporting-only', () => {
  it('names the streak in evidence when another trigger already fired', () => {
    const weeks: WeeklyPerformanceData[] = [
      { ...healthyWeek(1), sleepQuality: 2 },
      { ...healthyWeek(2), sleepQuality: 1, wearableDeviationDays: 6 },
    ];
    const triggers = checkDeloadTriggers(weeks, profile, periodization);
    expect(triggers.shouldDeload).toBe(true);
    expect(
      triggers.reasons.some((r) => r.includes('HRV/resting HR deviated from baseline'))
    ).toBe(true);
  });

  it('never triggers a deload on its own', () => {
    const weeks: WeeklyPerformanceData[] = [
      healthyWeek(1),
      { ...healthyWeek(2), wearableDeviationDays: 10 },
    ];
    const triggers = checkDeloadTriggers(weeks, profile, periodization);
    expect(triggers.shouldDeload).toBe(false);
    expect(triggers.reasons).toHaveLength(0);
  });
});

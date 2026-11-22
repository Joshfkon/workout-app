import { render, screen } from '@testing-library/react';
import {
  MuscleProgressionCard,
  buildingSummaryText,
  cappedRateText,
} from '../MuscleProgressionCard';
import {
  MIN_SESSIONS_FOR_INSIGHT,
  type ExerciseProgressionInsight,
  type MuscleGroupProgression,
  type ProgressionPace,
} from '@/services/progressionInsights';

function insight(sessions: number, pace: ProgressionPace = 'insufficient_data'): ExerciseProgressionInsight {
  return {
    exerciseId: `ex-${sessions}-${pace}`,
    pace,
    weeklyChangePct: 0,
    weeklyChangeKg: 0,
    expectedWeeklyPct: 1,
    currentE1RM: 100,
    isPlateaued: false,
    sessionsAnalyzed: sessions,
    confidence: pace === 'insufficient_data' ? 'insufficient' : 'high',
    workingSetsAnalyzed: sessions * 3,
  };
}

function group(
  muscleGroup: string,
  insights: ExerciseProgressionInsight[],
  extra: Partial<MuscleGroupProgression> = {}
): MuscleGroupProgression {
  return {
    muscleGroup,
    pace: 'insufficient_data',
    avgWeeklyChangePct: 0,
    rateImplausible: false,
    expectedWeeklyPct: 1,
    exerciseCount: insights.length,
    analyzedCount: 0,
    calibratingCount: 0,
    plateauedCount: 0,
    insights,
    ...extra,
  };
}

describe('buildingSummaryText', () => {
  it('names the real threshold and each muscle’s count, using its best-trained lift', () => {
    const { lead, detail } = buildingSummaryText([
      group('chest', [insight(1)]),
      group('back', [insight(1), insight(2)]),
    ]);
    expect(MIN_SESSIONS_FOR_INSIGHT).toBe(3);
    expect(lead).toBe("A pace shows once one of a muscle's lifts has 3 workouts:");
    expect(detail).toBe('Chest 1 of 3, Back 2 of 3. Closest: Back, 1 more workout.');
  });

  it('gives a direct next step for a single muscle', () => {
    expect(buildingSummaryText([group('chest', [insight(1)])]).detail).toBe(
      'Chest 1 of 3. Train Chest 2 more times to see its pace.'
    );
  });

  it('does not show a complete-looking count for a lift at the threshold with a noisy fit', () => {
    expect(buildingSummaryText([group('chest', [insight(3)])]).detail).toBe('Chest settling.');
  });
});

describe('MuscleProgressionCard', () => {
  it('renders the counts line instead of the vague "a few more sessions"', () => {
    render(
      <MuscleProgressionCard
        groups={[group('chest', [insight(1)]), group('back', [insight(2)])]}
      />
    );
    const line = screen.getByTestId('muscle-progression-building-summary');
    expect(line).toHaveTextContent('has 3 workouts: Chest 1 of 3, Back 2 of 3.');
    expect(line).not.toHaveTextContent(/a few more sessions/i);
  });

  it('explains a capped rate in plain words', () => {
    render(
      <MuscleProgressionCard
        groups={[
          group('chest', [insight(6, 'ahead')], {
            pace: 'ahead',
            avgWeeklyChangePct: 5,
            rateImplausible: true,
            analyzedCount: 1,
          }),
        ]}
      />
    );
    const note = screen.getByTestId('muscle-progression-capped-note');
    expect(note).toHaveTextContent("Chest's rate was capped");
    expect(note).toHaveTextContent(/mistyped or the equipment changed/);
  });

  it('pluralises the capped note for several muscles', () => {
    expect(cappedRateText(['Chest', 'Back'])).toMatch(/^Chest, Back rates were capped/);
  });
});

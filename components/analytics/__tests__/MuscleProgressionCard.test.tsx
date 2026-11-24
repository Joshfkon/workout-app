import { render, screen } from '@testing-library/react';
import {
  MuscleProgressionCard,
  buildingSummaryText,
  cappedRateText,
  muscleProgressionSubtitle,
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
    expect(buildingSummaryText([group('chest', [insight(3)])]).detail).toBe('Chest needs its workouts spread over 10+ days.');
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

  it('keeps the muscle name and its weekly change whole at phone width (no truncate)', () => {
    render(
      <MuscleProgressionCard
        groups={[
          group('rear_delts', [insight(6, 'on_track')], {
            pace: 'on_track',
            avgWeeklyChangePct: 0,
            analyzedCount: 1,
          }),
        ]}
        goal="cut"
      />
    );
    const name = screen.getByTestId('muscle-progression-name');
    const rate = screen.getByTestId('muscle-progression-rate');
    expect(rate).toHaveTextContent('+0% per week');
    expect(name.className).not.toMatch(/\btruncate\b/);
    expect(rate.className).not.toMatch(/\btruncate\b/);
    // Plain words, not "Progression by muscle group" / "on a cut".
    expect(screen.getByText('Strength by muscle')).toBeInTheDocument();
    expect(screen.getByText(/eating less to lose fat/)).toBeInTheDocument();
    expect(screen.queryByText(/on a cut/)).not.toBeInTheDocument();
  });

  it('pluralises the capped note for several muscles', () => {
    expect(cappedRateText(['Chest', 'Back'])).toMatch(/^Chest, Back rates were capped/);
  });
});

describe('muscleProgressionSubtitle', () => {
  it('names the window and says a muscle is the average of its lifts', () => {
    expect(muscleProgressionSubtitle('bulk', 0.15, 84)).toBe(
      "How fast each muscle's lifts are getting stronger over the last 12 weeks, vs the ~0.15% a week expected at your level. A muscle's rate is the average of its lifts, weighted by sets. Tap a muscle to see each lift."
    );
  });
  it('keeps the goal wording on a cut and omits the window when unknown', () => {
    const text = muscleProgressionSubtitle('cut', 0);
    expect(text).toMatch(/^How fast each muscle's lifts are getting stronger\. You're eating less/);
    expect(text).toMatch(/average of its lifts/);
  });
});

describe('flatBehindDisplay', () => {
  const { flatBehindDisplay } = jest.requireActual('../MuscleProgressionCard');
  it('a flat group behind pace reads "Holding · below pace"; a slow riser keeps the normal label', () => {
    expect(flatBehindDisplay({ pace: 'behind', avgWeeklyChangePct: 0 })).toEqual({ label: 'Holding · below pace', tone: 'warning' });
    expect(flatBehindDisplay({ pace: 'behind', avgWeeklyChangePct: 0.08 })).toBeNull();
    expect(flatBehindDisplay({ pace: 'on_track', avgWeeklyChangePct: 0 })).toBeNull();
  });
});

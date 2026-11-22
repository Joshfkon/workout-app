'use client';

import { Button, Card, ListGroup, ListRow } from '@/components/ui';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

export type CalibratePromptMode = 'card' | 'row' | 'hidden';

/**
 * How prominent the "Calibrate your strength" prompt is on Progress → Strength.
 *
 * - 'card': little or no strength data (no trended lift, no early-lift bests,
 *   no muscle progression) — the full card is the useful next step.
 * - 'row': the user already has lift data, so calibration is an optional
 *   extra (percentile rankings) — one small row, below everything else.
 * - 'hidden': lift trends haven't loaded yet. Rendering the card until they
 *   arrive would flash it at users with plenty of data.
 */
export function calibratePromptMode({
  liftTrends,
  liftTrendsLoaded,
  muscleProgressionCount,
}: {
  liftTrends: LiftTrendsSummary | null;
  liftTrendsLoaded: boolean;
  muscleProgressionCount: number;
}): CalibratePromptMode {
  const hasLiftData =
    (liftTrends?.lifts.length ?? 0) > 0 ||
    (liftTrends?.earlyLifts?.length ?? 0) > 0 ||
    muscleProgressionCount > 0;
  if (hasLiftData) return 'row';
  if (!liftTrendsLoaded) return 'hidden';
  return 'card';
}

export function CalibrateStrengthPrompt({
  mode,
  onStart,
}: {
  mode: CalibratePromptMode;
  onStart: () => void;
}) {
  if (mode === 'hidden') return null;

  if (mode === 'row') {
    return (
      <ListGroup>
        <ListRow
          title="Compare with other lifters (optional)"
          subtitle="A short strength test adds percentile rankings"
          onClick={onStart}
        />
      </ListGroup>
    );
  }

  return (
    <Card className="text-center py-6" data-testid="calibrate-strength-card">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-action/20 flex items-center justify-center">
        <svg className="w-6 h-6 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <h2 className="text-body font-semibold text-ink">Calibrate your strength</h2>
      <p className="text-subhead text-ink-2 mt-1.5 max-w-md mx-auto">
        Log a few workouts to see strength trends, percentile rankings, and personalized recommendations.
      </p>
      <Button className="mt-4" size="sm" onClick={onStart}>
        Start strength test
      </Button>
    </Card>
  );
}

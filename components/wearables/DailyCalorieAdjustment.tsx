'use client';

/**
 * Daily Calorie Adjustment Display
 *
 * Shows the user's calorie target for today with any activity-based adjustments
 * and explanation of why the target differs from their base goal.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { DailyCalorieTarget } from '@/types/wearable';

interface DailyCalorieAdjustmentProps {
  target: DailyCalorieTarget;
  currentCalories: number;
  onExplain?: () => void;
}

export function DailyCalorieAdjustment({
  target,
  currentCalories,
  onExplain,
}: DailyCalorieAdjustmentProps) {
  const [showDetails, setShowDetails] = useState(false);

  const progress = Math.min((currentCalories / target.adjustedTarget) * 100, 100);
  const remaining = target.adjustedTarget - currentCalories;
  const hasAdjustment = target.adjustment !== 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Target Header */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-subhead text-ink-3">Calorie target</span>
            {hasAdjustment && (
              <span
                className={`text-subhead font-medium ${
                  target.adjustment > 0 ? 'text-status-ok' : 'text-status-warn'
                }`}
              >
                {target.adjustment > 0 ? '+' : ''}
                {target.adjustment} from base
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-title font-bold">
              {target.adjustedTarget.toLocaleString()}
            </span>
            <span className="text-ink-3">cal</span>
            {hasAdjustment && (
              <span className="text-subhead text-ink-2">
                (base: {target.baseTarget.toLocaleString()})
              </span>
            )}
          </div>
          {hasAdjustment && (
            <p className="text-subhead text-ink-2 mt-1">
              {target.reason}
            </p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-subhead">
            <span className="text-ink-2">
              {currentCalories.toLocaleString()} eaten
            </span>
            <span
              className={`font-medium ${
                remaining >= 0 ? 'text-ink-2' : 'text-status-bad'
              }`}
            >
              {remaining >= 0
                ? `${remaining.toLocaleString()} remaining`
                : `${Math.abs(remaining).toLocaleString()} over`}
            </span>
          </div>
          <div className="h-3 bg-sep rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${getProgressColor(progress)}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Details Toggle */}
        {hasAdjustment && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide details' : 'Why is my target different?'}
          </Button>
        )}

        {/* Details Panel */}
        {showDetails && (
          <div className="p-3 bg-fill rounded-lg text-subhead space-y-2">
            <div className="flex justify-between">
              <span>Today&apos;s TDEE</span>
              <span>{target.tdeeEstimate.toLocaleString()} cal</span>
            </div>
            <div className="flex justify-between">
              <span>Target deficit</span>
              <span>{target.targetDeficit.toLocaleString()} cal</span>
            </div>
            <div className="flex justify-between font-medium pt-2 border-t border-sep">
              <span>Calorie target</span>
              <span>{target.adjustedTarget.toLocaleString()} cal</span>
            </div>

            {onExplain && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2"
                onClick={onExplain}
              >
                Learn more about activity-adjusted targets
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getProgressColor(progress: number): string {
  if (progress < 50) return 'bg-action';
  if (progress < 80) return 'bg-status-ok';
  if (progress < 95) return 'bg-status-warn';
  if (progress <= 100) return 'bg-orange-500';
  return 'bg-status-bad';
}

/**
 * Compact inline version for headers/summaries
 */
export function CompactCalorieTarget({
  target,
  currentCalories,
}: {
  target: DailyCalorieTarget;
  currentCalories: number;
}) {
  const remaining = target.adjustedTarget - currentCalories;
  const hasAdjustment = target.adjustment !== 0;

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">
        {currentCalories.toLocaleString()} / {target.adjustedTarget.toLocaleString()}
      </span>
      {hasAdjustment && (
        <span
          className={`text-caption px-1.5 py-0.5 rounded ${
            target.adjustment > 0
              ? 'bg-status-ok-tint text-status-ok'
              : 'bg-status-warn-tint text-status-warn'
          }`}
        >
          {target.adjustment > 0 ? '+' : ''}
          {target.adjustment}
        </span>
      )}
      <span className="text-ink-3 text-subhead">
        ({remaining >= 0 ? remaining.toLocaleString() : 0} left)
      </span>
    </div>
  );
}

/**
 * Activity summary badge showing step count and activity level
 */
export function ActivityBadge({
  steps,
  workoutLogged,
  activityLevel,
}: {
  steps: number;
  workoutLogged: boolean;
  activityLevel: string;
}) {
  const levelColors: Record<string, string> = {
    sedentary: 'bg-fill text-ink-2',
    light: 'bg-action-tint text-action',
    moderate: 'bg-status-ok-tint text-status-ok',
    active: 'bg-status-warn-tint text-status-warn',
    very_active: 'bg-status-bad-tint text-status-bad',
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-2">
        {steps.toLocaleString()} steps
      </span>
      {workoutLogged && (
        <span className="text-ink-2">Workout</span>
      )}
      <span
        className={`text-caption px-2 py-0.5 rounded-full ${levelColors[activityLevel] || levelColors.sedentary}`}
      >
        {formatActivityLevel(activityLevel)}
      </span>
    </div>
  );
}

function formatActivityLevel(level: string): string {
  const labels: Record<string, string> = {
    sedentary: 'Sedentary',
    light: 'Light',
    moderate: 'Moderate',
    active: 'Active',
    very_active: 'Very Active',
  };
  return labels[level] || level;
}

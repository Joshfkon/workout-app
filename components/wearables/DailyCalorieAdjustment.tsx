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
            <span className="text-sm text-surface-500">Calorie Target</span>
            {hasAdjustment && (
              <span
                className={`text-sm font-medium ${
                  target.adjustment > 0 ? 'text-green-500' : 'text-yellow-500'
                }`}
              >
                {target.adjustment > 0 ? '+' : ''}
                {target.adjustment} from base
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">
              {target.adjustedTarget.toLocaleString()}
            </span>
            <span className="text-surface-500">cal</span>
            {hasAdjustment && (
              <span className="text-sm text-surface-400">
                (base: {target.baseTarget.toLocaleString()})
              </span>
            )}
          </div>
          {hasAdjustment && (
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
              {target.reason}
            </p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-surface-600 dark:text-surface-400">
              {currentCalories.toLocaleString()} eaten
            </span>
            <span
              className={`font-medium ${
                remaining >= 0 ? 'text-surface-700 dark:text-surface-300' : 'text-red-500'
              }`}
            >
              {remaining >= 0
                ? `${remaining.toLocaleString()} remaining`
                : `${Math.abs(remaining).toLocaleString()} over`}
            </span>
          </div>
          <div className="h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
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
            {showDetails ? 'Hide Details' : 'Why is my target different?'}
          </Button>
        )}

        {/* Details Panel */}
        {showDetails && (
          <div className="p-3 bg-surface-50 dark:bg-surface-800 rounded-lg text-sm space-y-2">
            <div className="flex justify-between">
              <span>Today's TDEE</span>
              <span>{target.tdeeEstimate.toLocaleString()} cal</span>
            </div>
            <div className="flex justify-between">
              <span>Target deficit</span>
              <span>{target.targetDeficit.toLocaleString()} cal</span>
            </div>
            <div className="flex justify-between font-medium pt-2 border-t border-surface-200 dark:border-surface-700">
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
  if (progress < 50) return 'bg-blue-500';
  if (progress < 80) return 'bg-green-500';
  if (progress < 95) return 'bg-yellow-500';
  if (progress <= 100) return 'bg-orange-500';
  return 'bg-red-500';
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
          className={`text-xs px-1.5 py-0.5 rounded ${
            target.adjustment > 0
              ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
          }`}
        >
          {target.adjustment > 0 ? '+' : ''}
          {target.adjustment}
        </span>
      )}
      <span className="text-surface-500 text-sm">
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
    sedentary: 'bg-surface-200 text-surface-600',
    light: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    moderate: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    active: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    very_active: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-surface-600 dark:text-surface-400">
        👟 {steps.toLocaleString()} steps
      </span>
      {workoutLogged && (
        <span className="text-surface-600 dark:text-surface-400">💪 Workout</span>
      )}
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${levelColors[activityLevel] || levelColors.sedentary}`}
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

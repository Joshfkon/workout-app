'use client';

/**
 * Enhanced TDEE Dashboard
 *
 * Displays TDEE estimate with activity breakdown showing
 * base metabolism, step burn, and workout burn components.
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { EnhancedTDEEEstimate, DailyActivityData, DailyTDEEResult } from '@/types/wearable';
import { getDailyActivityData } from '@/lib/actions/wearable';

interface EnhancedTDEEDashboardProps {
  tdeeEstimate: EnhancedTDEEEstimate | null;
  currentWeight: number; // in lbs
  onViewBreakdown?: () => void;
}

export function EnhancedTDEEDashboard({
  tdeeEstimate,
  currentWeight,
  onViewBreakdown,
}: EnhancedTDEEDashboardProps) {
  const [todayActivity, setTodayActivity] = useState<DailyActivityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTodayActivity();
  }, []);

  async function loadTodayActivity() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await getDailyActivityData(today);
      setTodayActivity(data);
    } catch (error) {
      console.error('Failed to load today activity:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!tdeeEstimate) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-surface-500">
          <p className="mb-2">Not enough data for TDEE estimate</p>
          <p className="text-sm">Log your weight and calories daily for 2-3 weeks</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate today's TDEE if we have activity data
  const todayTDEE = calculateTodayTDEE(tdeeEstimate, todayActivity, currentWeight);
  const hasActivityData =
    todayActivity && (todayActivity.steps.total > 0 || todayActivity.appWorkouts.length > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <span>🔥</span>
          <span>Your Metabolism</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Today's Burn */}
        {hasActivityData && todayTDEE && (
          <div className="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm text-surface-500">Today's Estimated Burn</span>
              <span
                className={`text-sm font-medium ${
                  todayTDEE.vsAverage > 0 ? 'text-green-500' : 'text-surface-500'
                }`}
              >
                {todayTDEE.vsAverage > 0 ? '+' : ''}
                {todayTDEE.vsAverage} vs average
              </span>
            </div>
            <div className="text-3xl font-bold mb-4">
              {todayTDEE.totalTDEE.toLocaleString()} cal
            </div>

            {/* Breakdown */}
            <div className="space-y-2 border-t border-surface-200 dark:border-surface-700 pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-surface-600 dark:text-surface-400">
                  Base metabolism
                </span>
                <span>{todayTDEE.baseTDEE.toLocaleString()} cal</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-600 dark:text-surface-400">
                  Steps ({todayActivity?.steps.total.toLocaleString()})
                </span>
                <span>+{todayTDEE.stepExpenditure.toLocaleString()} cal</span>
              </div>
              {todayTDEE.workoutExpenditure > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-600 dark:text-surface-400">
                    Workout
                  </span>
                  <span>+{todayTDEE.workoutExpenditure.toLocaleString()} cal</span>
                </div>
              )}
              <div className="flex justify-between font-medium pt-2 border-t border-surface-200 dark:border-surface-700">
                <span>Total</span>
                <span>{todayTDEE.totalTDEE.toLocaleString()} cal</span>
              </div>
            </div>
          </div>
        )}

        {/* Average TDEE */}
        <div className="p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-surface-500">Your Average TDEE</span>
            <span className="text-sm text-surface-400">
              Based on {tdeeEstimate.dataPointsUsed} days of data
            </span>
          </div>
          <div className="text-2xl font-semibold mb-3">
            {tdeeEstimate.estimatedTDEE.toLocaleString()} cal/day
          </div>

          {/* Confidence indicator */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getConfidenceColor(
                  tdeeEstimate.confidence
                )}`}
                style={{ width: `${tdeeEstimate.confidenceScore}%` }}
              />
            </div>
            <span className="text-sm text-surface-500">
              {tdeeEstimate.confidenceScore}% confident
            </span>
          </div>
        </div>

        {/* Average Activity Stats */}
        {(tdeeEstimate.averageSteps > 0 || tdeeEstimate.averageWorkoutCalories > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {tdeeEstimate.averageSteps > 0 && (
              <div className="p-3 bg-surface-50 dark:bg-surface-800 rounded-lg text-center">
                <div className="text-lg font-semibold">
                  {tdeeEstimate.averageSteps.toLocaleString()}
                </div>
                <div className="text-xs text-surface-500">Avg daily steps</div>
              </div>
            )}
            {tdeeEstimate.averageWorkoutCalories > 0 && (
              <div className="p-3 bg-surface-50 dark:bg-surface-800 rounded-lg text-center">
                <div className="text-lg font-semibold">
                  {tdeeEstimate.averageWorkoutCalories}
                </div>
                <div className="text-xs text-surface-500">Avg workout burn</div>
              </div>
            )}
          </div>
        )}

        {/* View Breakdown Button */}
        {onViewBreakdown && (
          <Button variant="ghost" className="w-full" onClick={onViewBreakdown}>
            View Breakdown →
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function calculateTodayTDEE(
  estimate: EnhancedTDEEEstimate,
  activity: DailyActivityData | null,
  weight: number
): DailyTDEEResult | null {
  if (!activity) return null;

  // Calculate net steps (excluding workout overlap)
  const totalOverlap = activity.appWorkouts.reduce((sum, w) => sum + w.stepsOverlap, 0);
  const netSteps = activity.steps.total - totalOverlap;

  // Calculate components
  const baseTDEE = estimate.baseBurnRate * weight;
  const stepExpenditure = estimate.stepBurnRate * netSteps;
  const workoutExpenditure =
    estimate.workoutMultiplier * activity.calculated.workoutExpenditure;

  const totalTDEE = baseTDEE + stepExpenditure + workoutExpenditure;

  return {
    baseTDEE: Math.round(baseTDEE),
    stepExpenditure: Math.round(stepExpenditure),
    workoutExpenditure: Math.round(workoutExpenditure),
    totalTDEE: Math.round(totalTDEE),
    vsAverage: Math.round(totalTDEE - estimate.estimatedTDEE),
  };
}

function getConfidenceColor(confidence: 'unstable' | 'stabilizing' | 'stable'): string {
  switch (confidence) {
    case 'stable':
      return 'bg-green-500';
    case 'stabilizing':
      return 'bg-yellow-500';
    case 'unstable':
      return 'bg-red-500';
    default:
      return 'bg-surface-400';
  }
}

/**
 * Compact version for embedding in other screens
 */
export function CompactTDEECard({
  tdeeEstimate,
  todaySteps,
  todayWorkout,
}: {
  tdeeEstimate: EnhancedTDEEEstimate | null;
  todaySteps: number;
  todayWorkout: boolean;
}) {
  if (!tdeeEstimate) return null;

  const activityLevel =
    todaySteps > 10000
      ? 'Very Active'
      : todaySteps > 7500
        ? 'Active'
        : todaySteps > 5000
          ? 'Moderate'
          : todaySteps > 2500
            ? 'Light'
            : 'Sedentary';

  return (
    <div className="flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-xl">🔥</span>
        <div>
          <div className="font-medium">
            {tdeeEstimate.estimatedTDEE.toLocaleString()} cal/day
          </div>
          <div className="text-xs text-surface-500">
            {todaySteps.toLocaleString()} steps • {activityLevel}
            {todayWorkout && ' • Workout logged'}
          </div>
        </div>
      </div>
      <div className="text-sm text-surface-400">
        {tdeeEstimate.confidenceScore}%
      </div>
    </div>
  );
}

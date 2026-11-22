'use client';

/**
 * Enhanced TDEE Dashboard
 *
 * Displays TDEE estimate with activity breakdown showing
 * base metabolism, step burn, and workout burn components.
 */

import { IconFlame } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getLocalDateString } from '@/lib/utils';
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
      const today = getLocalDateString();
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
        <CardContent className="p-6 text-center text-ink-3">
          <p className="mb-2">Not enough data for TDEE estimate</p>
          <p className="text-subhead">Log your weight and calories daily for 2-3 weeks</p>
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
          <IconFlame className="h-5 w-5 text-action" stroke={1.75} aria-hidden="true" />
          <span>Your metabolism</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Today's Burn */}
        {hasActivityData && todayTDEE && (
          <div className="p-4 bg-fill rounded-lg">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-subhead text-ink-3">Today&apos;s Estimated Burn</span>
              <span
                className={`text-subhead font-medium ${
                  todayTDEE.vsAverage > 0 ? 'text-status-ok' : 'text-ink-3'
                }`}
              >
                {todayTDEE.vsAverage > 0 ? '+' : ''}
                {todayTDEE.vsAverage} vs average
              </span>
            </div>
            <div className="text-large-title font-bold mb-4">
              {todayTDEE.totalTDEE.toLocaleString()} cal
            </div>

            {/* Breakdown */}
            <div className="space-y-2 border-t border-sep pt-3">
              <div className="flex justify-between text-subhead">
                <span className="text-ink-2">
                  Base metabolism
                </span>
                <span>{todayTDEE.baseTDEE.toLocaleString()} cal</span>
              </div>
              <div className="flex justify-between text-subhead">
                <span className="text-ink-2">
                  Steps ({todayActivity?.steps.total.toLocaleString()})
                </span>
                <span>+{todayTDEE.stepExpenditure.toLocaleString()} cal</span>
              </div>
              {todayTDEE.workoutExpenditure > 0 && (
                <div className="flex justify-between text-subhead">
                  <span className="text-ink-2">
                    Workout
                  </span>
                  <span>+{todayTDEE.workoutExpenditure.toLocaleString()} cal</span>
                </div>
              )}
              <div className="flex justify-between font-medium pt-2 border-t border-sep">
                <span>Total</span>
                <span>{todayTDEE.totalTDEE.toLocaleString()} cal</span>
              </div>
            </div>
          </div>
        )}

        {/* Average TDEE */}
        <div className="p-4 bg-fill rounded-lg">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-subhead text-ink-3">Your average TDEE</span>
            <span className="text-subhead text-ink-2">
              Based on {tdeeEstimate.dataPointsUsed} days of data
            </span>
          </div>
          <div className="text-title font-semibold mb-3">
            {tdeeEstimate.estimatedTDEE.toLocaleString()} cal/day
          </div>

          {/* Confidence indicator */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-sep rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getConfidenceColor(
                  tdeeEstimate.confidence
                )}`}
                style={{ width: `${tdeeEstimate.confidenceScore}%` }}
              />
            </div>
            <span className="text-subhead text-ink-3">
              {tdeeEstimate.confidenceScore}% confident
            </span>
          </div>
        </div>

        {/* Average Activity Stats */}
        {(tdeeEstimate.averageSteps > 0 || tdeeEstimate.averageWorkoutCalories > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {tdeeEstimate.averageSteps > 0 && (
              <div className="p-3 bg-fill rounded-lg text-center">
                <div className="text-headline font-semibold">
                  {tdeeEstimate.averageSteps.toLocaleString()}
                </div>
                <div className="text-caption text-ink-3">Avg daily steps</div>
              </div>
            )}
            {tdeeEstimate.averageWorkoutCalories > 0 && (
              <div className="p-3 bg-fill rounded-lg text-center">
                <div className="text-headline font-semibold">
                  {tdeeEstimate.averageWorkoutCalories}
                </div>
                <div className="text-caption text-ink-3">Avg workout burn</div>
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
      return 'bg-status-ok';
    case 'stabilizing':
      return 'bg-status-warn';
    case 'unstable':
      return 'bg-status-bad';
    default:
      return 'bg-ink-3';
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
    <div className="flex items-center justify-between p-3 bg-fill rounded-lg">
      <div className="flex items-center gap-3">
        <IconFlame className="h-5 w-5 text-action" stroke={1.75} aria-hidden="true" />
        <div>
          <div className="font-medium">
            {tdeeEstimate.estimatedTDEE.toLocaleString()} cal/day
          </div>
          <div className="text-caption text-ink-3">
            {todaySteps.toLocaleString()} steps • {activityLevel}
            {todayWorkout && ' • Workout logged'}
          </div>
        </div>
      </div>
      <div className="text-subhead text-ink-2">
        {tdeeEstimate.confidenceScore}%
      </div>
    </div>
  );
}

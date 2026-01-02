'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';

interface HydrationTrackerProps {
  userId: string;
  unit?: 'ml' | 'oz';
}

const QUICK_ADD_OPTIONS = [
  { ml: 250, label: '250ml', labelOz: '8oz' },
  { ml: 500, label: '500ml', labelOz: '16oz' },
  { ml: 750, label: '750ml', labelOz: '24oz' },
  { ml: 1000, label: '1L', labelOz: '32oz' },
];

export function HydrationTracker({ userId, unit = 'ml' }: HydrationTrackerProps) {
  const [todayTotal, setTodayTotal] = useState(0);
  const [target, setTarget] = useState(2500); // Default 2.5L
  const [isAdding, setIsAdding] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  const supabase = createUntypedClient();

  useEffect(() => {
    loadTodayData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadTodayData() {
    const today = getLocalDateString();

    // Fetch hydration data and targets in parallel for faster loading
    const [hydrationResult, targetsResult] = await Promise.all([
      supabase
        .from('hydration_log')
        .select('amount_ml')
        .eq('user_id', userId)
        .eq('logged_at', today),
      supabase
        .from('nutrition_targets')
        .select('water_ml')
        .eq('user_id', userId)
        .single()
    ]);

    if (hydrationResult.data) {
      const total = hydrationResult.data.reduce((sum: number, entry: { amount_ml?: number }) => sum + (entry.amount_ml || 0), 0);
      setTodayTotal(total);
    }

    if (targetsResult.data?.water_ml) {
      setTarget(targetsResult.data.water_ml);
    }
  }

  async function addWater(amountMl: number) {
    setIsAdding(true);
    const today = getLocalDateString();

    const { error } = await supabase.from('hydration_log').insert({
      user_id: userId,
      logged_at: today,
      amount_ml: amountMl,
      source: 'water',
    });

    if (!error) {
      setTodayTotal(prev => prev + amountMl);
    }
    setIsAdding(false);
    setShowCustom(false);
    setCustomAmount('');
  }

  const handleCustomAdd = () => {
    const amount = parseInt(customAmount);
    if (amount > 0) {
      const amountMl = unit === 'oz' ? Math.round(amount * 29.5735) : amount;
      addWater(amountMl);
    }
  };

  // Convert to display units
  const displayTotal = unit === 'oz' ? Math.round(todayTotal / 29.5735) : todayTotal;
  const displayTarget = unit === 'oz' ? Math.round(target / 29.5735) : target;
  const displayUnit = unit === 'oz' ? 'oz' : 'ml';

  const percentage = Math.min(100, Math.round((todayTotal / target) * 100));
  const isComplete = todayTotal >= target;

  // Calculate if on track based on time of day
  // Assuming waking hours are 7am to 11pm (16 hours)
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const wakeUpHour = 7;
  const bedTimeHour = 23;
  const totalWakingHours = bedTimeHour - wakeUpHour;
  
  // Calculate what percentage of the day has passed (within waking hours)
  let dayProgress = 0;
  if (currentHour >= bedTimeHour) {
    dayProgress = 100;
  } else if (currentHour <= wakeUpHour) {
    dayProgress = 0;
  } else {
    dayProgress = ((currentHour - wakeUpHour) / totalWakingHours) * 100;
  }
  
  // Expected progress vs actual
  const expectedPercentage = Math.round(dayProgress);
  const progressDiff = percentage - expectedPercentage;
  
  // Determine status
  const getTrackingStatus = () => {
    if (isComplete) return { status: 'complete', label: 'Goal reached!', color: 'text-success-400', emoji: '🎉' };
    if (progressDiff >= 10) return { status: 'ahead', label: 'Ahead of schedule', color: 'text-success-400', emoji: '💪' };
    if (progressDiff >= -10) return { status: 'ontrack', label: 'On track', color: 'text-primary-400', emoji: '✓' };
    if (progressDiff >= -25) return { status: 'behind', label: 'Slightly behind', color: 'text-warning-400', emoji: '⚠️' };
    return { status: 'way-behind', label: 'Catch up!', color: 'text-danger-400', emoji: '🚰' };
  };
  
  const trackingStatus = getTrackingStatus();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            💧 Hydration
          </span>
          <span className={`text-xs ${trackingStatus.color} flex items-center gap-1`}>
            {trackingStatus.emoji} {trackingStatus.label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress Display */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-surface-300">
                {displayTotal.toLocaleString()} / {displayTarget.toLocaleString()} {displayUnit}
              </span>
              <span className={percentage >= 100 ? 'text-success-400' : 'text-surface-400'}>
                {percentage}%
              </span>
            </div>
            <div className="h-3 bg-surface-800 rounded-full overflow-hidden relative">
              {/* Expected progress marker */}
              {!isComplete && expectedPercentage > 0 && expectedPercentage < 100 && (
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-surface-500 z-10"
                  style={{ left: `${expectedPercentage}%` }}
                  title={`Expected: ${expectedPercentage}%`}
                />
              )}
              {/* Actual progress bar */}
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  percentage >= 100 
                    ? 'bg-success-500' 
                    : percentage >= expectedPercentage 
                    ? 'bg-primary-500' 
                    : percentage >= expectedPercentage - 15
                    ? 'bg-warning-500'
                    : 'bg-danger-500'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            {!isComplete && (
              <div className="text-xs text-surface-500 mt-1">
                {progressDiff >= 0 ? (
                  <span>+{progressDiff}% vs expected</span>
                ) : (
                  <span>{progressDiff}% vs expected</span>
                )}
              </div>
            )}
          </div>
          {/* Water drop visual */}
          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
            <span className="text-2xl">💧</span>
          </div>
        </div>

        {/* Quick Add Buttons */}
        {!showCustom ? (
          <div className="grid grid-cols-4 gap-2">
            {QUICK_ADD_OPTIONS.map((option) => (
              <button
                key={option.ml}
                onClick={() => addWater(option.ml)}
                disabled={isAdding}
                className="py-2 px-1 bg-surface-800 hover:bg-surface-700 rounded-lg text-xs font-medium text-surface-200 transition-colors disabled:opacity-50"
              >
                {unit === 'oz' ? option.labelOz : option.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder={`Amount in ${displayUnit}`}
              className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100"
            />
            <Button onClick={handleCustomAdd} disabled={isAdding || !customAmount} size="sm">
              Add
            </Button>
            <Button variant="ghost" onClick={() => setShowCustom(false)} size="sm">
              ✕
            </Button>
          </div>
        )}

        {/* Custom Amount Toggle */}
        {!showCustom && (
          <button
            onClick={() => setShowCustom(true)}
            className="w-full py-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            + Custom amount
          </button>
        )}
      </CardContent>
    </Card>
  );
}


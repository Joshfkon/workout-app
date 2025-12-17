'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

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
    const today = new Date().toISOString().split('T')[0];

    // Get today's total
    const { data: hydrationData } = await supabase
      .from('hydration_log')
      .select('amount_ml')
      .eq('user_id', userId)
      .eq('logged_at', today);

    if (hydrationData) {
      const total = hydrationData.reduce((sum: number, entry: { amount_ml?: number }) => sum + (entry.amount_ml || 0), 0);
      setTodayTotal(total);
    }

    // Get target from nutrition_targets
    const { data: targetsData } = await supabase
      .from('nutrition_targets')
      .select('water_ml')
      .eq('user_id', userId)
      .single();

    if (targetsData?.water_ml) {
      setTarget(targetsData.water_ml);
    }
  }

  async function addWater(amountMl: number) {
    setIsAdding(true);
    const today = new Date().toISOString().split('T')[0];

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          💧 Hydration
          {isComplete && <span className="text-xs text-success-400">✓ Goal reached!</span>}
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
            <div className="h-3 bg-surface-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  percentage >= 100 
                    ? 'bg-success-500' 
                    : percentage >= 50 
                    ? 'bg-primary-500' 
                    : 'bg-blue-500'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
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


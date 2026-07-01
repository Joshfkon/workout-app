'use client';

import { IconTarget } from '@tabler/icons-react';
import { Button } from '@/components/ui';

interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface MacroTargets {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

interface MacroSummaryCardProps {
  totals: MacroTotals;
  targets: MacroTargets | null;
  /** Meals still unlogged today (existing remaining-per-meal math, computed by the page) */
  mealsRemaining: number;
  onCalculateMacros: () => void;
  onEnterManually: () => void;
}

function MacroColumn({
  label,
  value,
  target,
  fillClass,
}: {
  label: string;
  value: number;
  target: number | null;
  fillClass: string;
}) {
  const pct = target && target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div>
      <div className="text-[11px] text-surface-500 mb-1">
        {label} {Math.round(value)}
        {target ? ` / ${target}g` : 'g'}
      </div>
      {target ? (
        <div className="h-[3px] bg-surface-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${fillClass} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Single-card daily macro summary (Phase 4.1): kcal headline + remaining-per-meal,
 * 5px calorie bar, and three mini macro columns. Replaces the old 4-box grid and
 * the separate remaining-calories section.
 */
export function MacroSummaryCard({
  totals,
  targets,
  mealsRemaining,
  onCalculateMacros,
  onEnterManually,
}: MacroSummaryCardProps) {
  // First-run: no targets yet — keep the personalized-targets CTA
  if (!targets?.calories) {
    return (
      <div className="rounded-xl border border-primary-500/20 bg-primary-500/10 p-4">
        <div className="flex items-start gap-3">
          <IconTarget size={20} className="text-primary-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h4 className="text-[15px] font-medium text-surface-100">Get personalized macro targets</h4>
            <p className="text-[13px] text-surface-300 mt-1">
              Let us calculate your ideal calories and macros based on your body stats,
              activity level, and goals.
            </p>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={onCalculateMacros}>
                Calculate my macros
              </Button>
              <Button variant="ghost" size="sm" onClick={onEnterManually}>
                Enter manually
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const kcal = Math.round(totals.calories);
  const target = targets.calories;
  const remaining = Math.round(target - totals.calories);
  const over = remaining < 0;
  const perMeal = !over && mealsRemaining > 0 ? Math.round(remaining / mealsRemaining) : 0;
  const caloriePct = Math.min((totals.calories / target) * 100, 100);

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900 p-4">
      {/* Row 1: headline + remaining */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-medium text-surface-100">
          {kcal.toLocaleString()} <span className="text-surface-500 font-normal">/ {target.toLocaleString()} kcal</span>
        </div>
        <div className={`text-[11px] ${over ? 'text-danger-400' : 'text-surface-500'}`}>
          {over
            ? `${Math.abs(remaining).toLocaleString()} over target`
            : `${remaining.toLocaleString()} left${perMeal > 0 ? ` · ~${perMeal.toLocaleString()} per meal` : ''}`}
        </div>
      </div>

      {/* Row 2: 5px calorie bar */}
      <div className="mt-2 h-[5px] bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-danger-500' : 'bg-primary-500'}`}
          style={{ width: `${caloriePct}%` }}
        />
      </div>

      {/* Row 3: macro mini-columns */}
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <MacroColumn label="Protein" value={totals.protein} target={targets.protein} fillClass="bg-success-500" />
        <MacroColumn label="Carbs" value={totals.carbs} target={targets.carbs} fillClass="bg-warning-500" />
        <MacroColumn label="Fat" value={totals.fat} target={targets.fat} fillClass="bg-danger-500" />
      </div>
    </div>
  );
}

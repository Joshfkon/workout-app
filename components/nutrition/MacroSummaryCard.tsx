'use client';

import { IconTarget } from '@tabler/icons-react';
import { Button, ProgressRing } from '@/components/ui';

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

function MacroBar({
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
      <div className="flex justify-between text-subhead tabular-nums text-ink-2">
        <span className="font-semibold text-ink">{label}</span>
        <span>
          {Math.round(value)}
          {target ? ` / ${target} g` : ' g'}
        </span>
      </div>
      {target ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-fill">
          <div className={`h-full rounded-full transition-all ${fillClass}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Daily macro summary (design system "Eat"): a calorie ring showing what's
 * LEFT (the actionable number) and three macro bars in the macro colours
 * (protein teal, carbs orange, fat violet — never the status colours, so
 * "over target" can be red without reading as "fat"). Tapping opens the
 * macro calculator.
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
      <div className="rounded-card bg-card p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] bg-action-tint text-action" aria-hidden="true">
            <IconTarget size={18} />
          </span>
          <div>
            <h4 className="text-headline text-ink">Get personalized macro targets</h4>
            <p className="mt-1 text-subhead text-ink-2">
              Let us calculate your ideal calories and macros based on your body stats,
              activity level, and goals.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" size="sm" onClick={onCalculateMacros}>
                Calculate my macros
              </Button>
              <Button variant="tertiary" size="sm" onClick={onEnterManually}>
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

  return (
    <button
      type="button"
      onClick={onCalculateMacros}
      aria-label="Open macro calculator to review or update your targets"
      className="flex w-full items-center gap-5 rounded-card bg-card p-4 text-left shadow-card transition-colors active:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      <ProgressRing
        progress={kcal / target}
        colorClassName={over ? 'stroke-status-bad' : 'stroke-action'}
        label={`${kcal.toLocaleString()} of ${target.toLocaleString()} kcal eaten`}
      >
        <span className="text-title font-bold leading-7 tabular-nums text-ink">
          {Math.abs(remaining).toLocaleString()}
        </span>
        <span className={`text-caption ${over ? 'text-status-bad' : 'text-ink-2'}`}>
          {over ? 'kcal over' : 'kcal left'}
        </span>
      </ProgressRing>

      <div className="min-w-0 flex-1 space-y-2.5">
        <MacroBar label="Protein" value={totals.protein} target={targets.protein} fillClass="bg-macro-protein" />
        <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} fillClass="bg-macro-carbs" />
        <MacroBar label="Fat" value={totals.fat} target={targets.fat} fillClass="bg-macro-fat" />
        <p className="text-caption text-ink-2 tabular-nums">
          {kcal.toLocaleString()} / {target.toLocaleString()} kcal
          {perMeal > 0 ? ` · ~${perMeal.toLocaleString()} per meal` : ''}
        </p>
      </div>
    </button>
  );
}

'use client';

import { useState } from 'react';
import { Input } from '@/components/ui';
import { GOAL_PERCENT_BW, type ActivityLevel, type Goal as NutritionGoal } from '@/lib/nutrition/macroCalculator';
import {
  CALORIE_EDIT_MAX,
  PROTEIN_EDIT_RANGE,
  calorieEditMin,
  type StarterCalorieBasis,
  type StarterProteinBasis,
} from '@/lib/nutrition/phaseTargets';
import type { WeightUnit } from '@/types/schema';

const LB_PER_KG = 2.20462;

/** Daily life outside workouts, as the calculator's levels mean it. */
const ACTIVITY_WORDS: Record<ActivityLevel, string> = {
  sedentary: 'mostly sitting',
  light: 'light daily activity',
  moderate: 'an on-your-feet day',
  active: 'a very active day',
  very_active: 'hard physical work',
  athlete: 'an athlete’s day',
};

const kcal = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * The pace's name for the breakdown: "Moderate cut", "Lean bulk"; "Your
 * pace" for a typed kg-a-week pace; null for maintenance. Pure.
 */
export function targetsGoalName(goal: NutritionGoal, typedPace: boolean): string | null {
  if (goal === 'maintain') return null;
  if (typedPace) return 'Your pace';
  return GOAL_PERCENT_BW[goal].description.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * The calorie figure, step by step, in plain words with the user's own
 * numbers: maintenance (from what), the change for the pace (and why a lean
 * lifter's cut is capped), the result. Pure (exported for tests).
 */
export function calorieBasisLines(basis: StarterCalorieBasis, units: WeightUnit, goalName: string | null): string[] {
  const workouts =
    basis.workoutsPerWeek > 0
      ? ` plus ${basis.workoutsPerWeek} workout${basis.workoutsPerWeek === 1 ? '' : 's'} a week (~${kcal(basis.workoutKcalPerDay)} kcal a day)`
      : '';
  const lines = [
    `Estimated maintenance: ~${kcal(basis.maintenanceKcal)} kcal a day. That's your resting burn ` +
      `(${kcal(basis.restingKcal)} kcal, ${basis.restingFromLeanMass ? 'from your lean mass' : 'from your weight, height and age'}) ` +
      `with ${ACTIVITY_WORDS[basis.activityLevel]}${workouts}.`,
  ];
  const adj = Math.round(basis.adjustmentKcal);
  const perWeek = Math.abs(basis.weeklyChangeKg) * (units === 'lb' ? LB_PER_KG : 1);
  const pace = `about ${perWeek.toFixed(2).replace(/0$/, '')} ${units} a week`;
  if (Math.abs(adj) < 25) {
    lines.push(`${goalName ?? 'Maintain'}: eat about what you burn.`);
  } else {
    const name = goalName ?? (adj < 0 ? 'Cut' : 'Bulk');
    let line = `${name}: ${adj < 0 ? '−' : '+'}${kcal(Math.abs(adj))} kcal a day, to ${adj < 0 ? 'lose' : 'gain'} ${pace}.`;
    if (basis.lossCap) {
      const requested = Math.round(Math.abs(basis.requestedPercentBW) * 100) / 100;
      // Body fat skipped: the cap is the calculator's default, not a
      // reading of theirs ("At 0% body fat" before UX round 23).
      const at = basis.lossCap.bodyFatPercent > 0 ? `At ${basis.lossCap.bodyFatPercent}% body fat` : 'Without your body fat';
      line +=
        ` ${at} the app holds loss to ${basis.lossCap.percentBW}% of body weight a week` +
        ` (not ${requested}%), so you keep muscle.`;
    }
    lines.push(line);
  }
  lines.push(
    basis.setByHand
      ? `Calories: set by you. The calculated figure was ${kcal(basis.calculated)} kcal.`
      : `Target: ${kcal(basis.maintenanceKcal)} ${adj < 0 ? '−' : '+'} ${kcal(Math.abs(adj))} = ${kcal(basis.calculated)} kcal a day.`
  );
  return lines;
}

/**
 * The sum in one short line, shown right under the numbers so the working is
 * on screen with the target itself (UX round 23: Dre read the card's top
 * line and Edit at the bottom of the screen, the breakdown sat below the
 * fold). "2,963 maintenance − 285 for a moderate cut". Pure.
 */
export function calorieFormulaLine(basis: StarterCalorieBasis, goalName: string | null): string {
  if (basis.setByHand) return `Set by you. Calculated: ${kcal(basis.calculated)} kcal.`;
  const adj = Math.round(basis.adjustmentKcal);
  const base = `~${kcal(basis.maintenanceKcal)} kcal you burn a day`;
  if (Math.abs(adj) < 25) return `= ${base} (maintain)`;
  const what = (goalName ?? (adj < 0 ? 'Cut' : 'Bulk')).toLowerCase();
  return `${base} ${adj < 0 ? '−' : '+'} ${kcal(Math.abs(adj))} for ${what === 'your pace' ? 'your pace' : `a ${what}`}`;
}

/**
 * How protein is set, in one plain line with the user's own numbers. Pure
 * (exported for tests). The rule is the macro calculator's: 1 g per lb of
 * lean mass (1.1 on a cut), lean mass from body fat when given.
 */
export function proteinBasisLine(basis: StarterProteinBasis, units: WeightUnit): string {
  const lean =
    units === 'lb'
      ? `${Math.round(basis.leanMassKg * LB_PER_KG)} lb`
      : `${Math.round(basis.leanMassKg)} kg`;
  const perUnit =
    units === 'lb'
      ? `${basis.perLbLeanMass.toFixed(1)} g per lb of lean mass`
      : `${(basis.perLbLeanMass * LB_PER_KG).toFixed(1)} g per kg of lean mass`;
  const leanFrom = basis.fromBodyFat ? 'from your body fat' : 'estimated, since body fat was skipped';
  const total = `about ${basis.perKgBodyWeight.toFixed(1)} g per kg of body weight`;
  if (basis.setByHand) {
    return `Protein: set by you (${total}). The calculated figure was ${basis.calculated} g: ${perUnit}, lean mass ${lean} (${leanFrom}).`;
  }
  return (
    `Protein: ${perUnit}${basis.perLbLeanMass > 1 ? ' (higher while losing fat, to protect muscle)' : ''}. ` +
    `Your lean mass is ${lean} (${leanFrom}), so ${total}.`
  );
}

/** Protein's working in one short line: "2.4 g per kg of lean mass (70 kg)". Pure. */
export function proteinShortLine(basis: StarterProteinBasis, units: WeightUnit): string {
  if (basis.setByHand) return `Set by you. Calculated: ${basis.calculated} g.`;
  const lean = units === 'lb' ? `${Math.round(basis.leanMassKg * LB_PER_KG)} lb` : `${Math.round(basis.leanMassKg)} kg`;
  const per =
    units === 'lb'
      ? `${basis.perLbLeanMass.toFixed(1)} g per lb`
      : `${(basis.perLbLeanMass * LB_PER_KG).toFixed(1)} g per kg`;
  return `${per} of your lean mass (${lean})`;
}

/** Stepper sizes for the inline −/+ on the card. */
export const CALORIE_STEP = 50;
export const PROTEIN_STEP = 5;

export interface DailyTargetsCardProps {
  calories: number;
  protein: number;
  calorieBasis: StarterCalorieBasis;
  proteinBasis: StarterProteinBasis;
  /** "Moderate cut", for the breakdown; null = maintenance. */
  goalName: string | null;
  units: WeightUnit;
  sex: 'male' | 'female';
  /** Hand-set values (null = calculated), so the editor reopens on them. */
  calorieOverride: number | null;
  proteinOverride: number | null;
  onCaloriesChange?: (kcal: number | null) => void;
  onProteinChange?: (grams: number | null) => void;
  /** A line under the breakdown (what Continue saves, where to change later). */
  footnote?: string;
  /** Small label above the numbers. */
  heading?: string;
  'data-testid'?: string;
}

/**
 * New daily targets with the working shown and one visible Edit for both
 * numbers (UX panel round 21: "no explanation of the numbers and no obvious
 * way to edit them"). Editing calories keeps protein and fat (carbs move);
 * editing protein keeps calories (carbs move): lib/nutrition/phaseTargets.
 */
export function DailyTargetsCard({
  calories,
  protein,
  calorieBasis,
  proteinBasis,
  goalName,
  units,
  sex,
  calorieOverride,
  proteinOverride,
  onCaloriesChange,
  onProteinChange,
  footnote,
  heading = 'Your daily targets',
  'data-testid': testId = 'goal-daily-targets',
}: DailyTargetsCardProps) {
  const canEdit = !!onCaloriesChange || !!onProteinChange;
  const [editing, setEditing] = useState(false);
  const [calorieText, setCalorieText] = useState(calorieOverride != null ? String(calorieOverride) : '');
  const [proteinText, setProteinText] = useState(proteinOverride != null ? String(proteinOverride) : '');
  const calMin = calorieEditMin(sex);
  const calValue = Number(calorieText);
  const calInvalid =
    calorieText.trim() !== '' && !(Number.isFinite(calValue) && calValue >= calMin && calValue <= CALORIE_EDIT_MAX);
  const proValue = Number(proteinText);
  const proInvalid =
    proteinText.trim() !== '' &&
    !(Number.isFinite(proValue) && proValue >= PROTEIN_EDIT_RANGE.min && proValue <= PROTEIN_EDIT_RANGE.max);
  const anyByHand = calorieBasis.setByHand || proteinBasis.setByHand;

  return (
    <div className="rounded-card bg-card p-4 shadow-card" data-testid={testId}>
      {/* Each number with its own −/+ and its working right under it, so
          "how is this worked out" and "can I change it" are answered where
          the eye lands (UX panel, final run: 5 of 6 still missed the
          breakdown and the Edit button below the numbers). */}
      <p className="text-subhead text-ink-2">{heading}</p>
      <TargetRow
        label="Calories"
        value={`${calories.toLocaleString()} kcal`}
        working={calorieFormulaLine(calorieBasis, goalName)}
        workingTestId="targets-formula"
        onStep={
          onCaloriesChange
            ? (dir) => {
                const next = Math.min(CALORIE_EDIT_MAX, Math.max(calMin, Math.round(calories) + dir * CALORIE_STEP));
                setCalorieText(String(next));
                onCaloriesChange(next);
              }
            : undefined
        }
        stepLabel={`${CALORIE_STEP} kcal`}
        testId="targets-calories-row"
      />
      <TargetRow
        label="Protein"
        value={`${Math.round(protein)} g`}
        working={proteinShortLine(proteinBasis, units)}
        workingTestId="targets-protein-short"
        onStep={
          onProteinChange
            ? (dir) => {
                const next = Math.min(PROTEIN_EDIT_RANGE.max, Math.max(PROTEIN_EDIT_RANGE.min, Math.round(protein) + dir * PROTEIN_STEP));
                setProteinText(String(next));
                onProteinChange(next);
              }
            : undefined
        }
        stepLabel={`${PROTEIN_STEP} g`}
        testId="targets-protein-row"
      />
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={editing ? 'Done editing targets' : 'Edit calories and protein'}
            className="min-h-[44px] text-body font-semibold text-action"
            data-testid="targets-edit"
          >
            {editing ? 'Done' : 'Type exact numbers'}
          </button>
          {anyByHand && !editing && (
            <button
              type="button"
              className="min-h-[44px] text-body font-medium text-ink-2"
              onClick={() => {
                setCalorieText('');
                setProteinText('');
                onCaloriesChange?.(null);
                onProteinChange?.(null);
              }}
            >
              Reset to calculated
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-sep pt-3" data-testid="targets-editor">
          {onCaloriesChange && (
            <Input
              label="Calories (kcal a day)"
              type="number"
              inputMode="numeric"
              value={calorieText}
              placeholder={String(calorieBasis.calculated)}
              onChange={(e) => {
                const next = e.target.value;
                setCalorieText(next);
                const n = Number(next);
                if (next.trim() === '') onCaloriesChange(null);
                else if (Number.isFinite(n) && n >= calMin && n <= CALORIE_EDIT_MAX) onCaloriesChange(n);
              }}
              error={calInvalid ? `Enter ${kcal(calMin)}–${kcal(CALORIE_EDIT_MAX)} kcal.` : undefined}
              hint={`Protein and fat stay; carbs make room. Leave empty to use ${kcal(calorieBasis.calculated)}.`}
              data-testid="targets-calories-input"
            />
          )}
          {onProteinChange && (
            <Input
              label="Protein (g a day)"
              type="number"
              inputMode="numeric"
              value={proteinText}
              placeholder={String(proteinBasis.calculated)}
              onChange={(e) => {
                const next = e.target.value;
                setProteinText(next);
                const n = Number(next);
                if (next.trim() === '') onProteinChange(null);
                else if (Number.isFinite(n) && n >= PROTEIN_EDIT_RANGE.min && n <= PROTEIN_EDIT_RANGE.max) {
                  onProteinChange(n);
                }
              }}
              error={proInvalid ? `Enter ${PROTEIN_EDIT_RANGE.min}–${PROTEIN_EDIT_RANGE.max} g.` : undefined}
              hint={`Calories stay the same; carbs make room. Leave empty to use ${proteinBasis.calculated} g.`}
              data-testid="goal-protein-input"
            />
          )}
          {anyByHand && (
            <button
              type="button"
              className="min-h-[44px] text-body font-medium text-action"
              data-testid="targets-use-calculated"
              onClick={() => {
                setCalorieText('');
                setProteinText('');
                onCaloriesChange?.(null);
                onProteinChange?.(null);
              }}
            >
              Use the calculated numbers
            </button>
          )}
        </div>
      )}

      <details className="mt-3 border-t border-sep pt-3" data-testid="goal-targets-source">
        <summary className="min-h-[44px] cursor-pointer text-subhead font-medium text-action">Show the full working</summary>
        <ul className="mt-1 space-y-1 text-subhead text-ink-2">
          {calorieBasisLines(calorieBasis, units, goalName).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li data-testid="goal-protein-basis">{proteinBasisLine(proteinBasis, units)}</li>
        </ul>
      </details>
      {footnote && <p className="mt-2 text-caption text-ink-3">{footnote}</p>}
    </div>
  );
}

function TargetRow({
  label,
  value,
  working,
  workingTestId,
  onStep,
  stepLabel,
  testId,
}: {
  label: string;
  value: string;
  working: string;
  workingTestId: string;
  onStep?: (dir: -1 | 1) => void;
  stepLabel: string;
  testId: string;
}) {
  const btn =
    'h-11 w-11 flex-shrink-0 rounded-full bg-fill text-title font-semibold text-action active:scale-[0.95]';
  return (
    <div className="mt-2 flex items-center gap-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="text-subhead text-ink-2">{label}</p>
        <p className="text-title font-bold text-ink tabular-nums">{value}</p>
        <p className="text-caption text-ink-2 tabular-nums" data-testid={workingTestId}>
          {working}
        </p>
      </div>
      {onStep && (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => onStep(-1)} aria-label={`Lower ${label.toLowerCase()} by ${stepLabel}`}>
            −
          </button>
          <button type="button" className={btn} onClick={() => onStep(1)} aria-label={`Raise ${label.toLowerCase()} by ${stepLabel}`}>
            +
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * ServingAmountEditor — the single AMOUNT + UNIT control shared by the add
 * sheet (search / barcode / manual), the weight/system/custom food paths and
 * the edit sheet. One component, many entry points: whatever the food source,
 * it is normalised to a {@link FoodAmountModel} and driven through here so the
 * live macro preview and the eventual log entry always agree.
 *
 * It is controlled: the parent owns `{ amount, unitId }` and computes the log
 * payload with the same {@link computeServing} used for the preview.
 */

import { useMemo } from 'react';
import {
  computeServing,
  equivalentAmounts,
  getUnit,
  round2,
  DEFAULT_WEIGHT_CHIPS,
  DEFAULT_SERVING_CHIPS,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';
import { stepAmount } from '@/lib/nutrition/portionDefaults';
import { IconMinus, IconPlus } from '@tabler/icons-react';

export interface ServingAmountValue {
  amount: string;
  unitId: string;
}

interface ServingAmountEditorProps {
  model: FoodAmountModel;
  value: ServingAmountValue;
  onChange: (value: ServingAmountValue) => void;
  /** The user's last distinct amounts for this food/unit, appended as chips. */
  recentAmounts?: number[];
  /** Hide the built-in macro preview (parent renders its own). Default false. */
  hidePreview?: boolean;
  /** testid prefix so add vs edit surfaces can be asserted independently. */
  testIdPrefix?: string;
  /** The user's weight preference; 'kg' leaves ounces out of "Same as". */
  weightUnits?: 'lb' | 'kg' | null;
}

function chipLabel(model: FoodAmountModel, unitId: string, amount: number): string {
  const unit = getUnit(model, unitId);
  if (unit.kind === 'weight') return `${amount}${unit.noun}`;
  return `${amount}×`;
}

export function ServingAmountEditor({
  model,
  value,
  onChange,
  recentAmounts = [],
  hidePreview = false,
  testIdPrefix = 'serving',
  weightUnits = null,
}: ServingAmountEditorProps) {
  const unit = getUnit(model, value.unitId);

  const preview = useMemo(
    () => computeServing(model, value.amount, value.unitId),
    [model, value.amount, value.unitId]
  );

  // Default chips depend on the SELECTED unit: gram presets when weighing,
  // ×-multiples when counting servings. (A serving-based food switched to grams
  // must not show "0.5g / 1g / 1.5g / 2g" — useless sub-gram amounts.) Then the
  // user's recent distinct amounts are appended, so one tap beats typing.
  const chips = useMemo(() => {
    const base = unit.kind === 'weight' ? DEFAULT_WEIGHT_CHIPS : DEFAULT_SERVING_CHIPS;
    const merged: number[] = [...base];
    for (const amt of recentAmounts) {
      if (!merged.includes(amt)) merged.push(amt);
    }
    return merged;
  }, [unit.kind, recentAmounts]);

  // For a serving unit backed by a known gram weight, show what the portion
  // weighs in plain words — "1 large egg · 50 g", "2 large egg · 100 g" — as
  // helper text rather than inside the dropdown label.
  const servingGramsHint = (() => {
    if (unit.kind !== 'serving' || !unit.gramsPerUnit || unit.gramsPerUnit <= 0) return null;
    const amt = parseFloat(value.amount);
    const shownAmount = Number.isFinite(amt) && amt > 0 ? amt : 1;
    // "1 × 2 tbsp" reads better than "1 2 tbsp" when the noun carries a count.
    const sep = /^\d/.test(unit.noun) ? ' × ' : ' ';
    const grams = round2(unit.gramsPerUnit * shownAmount);
    return `${round2(shownAmount)}${sep}${unit.noun} · ${grams >= 10 ? Math.round(grams) : grams} g`;
  })();

  // "Same as 4 oz · 1 palm-size portion" under a weight, so someone who
  // doesn't think in grams can read (or switch to) their own unit.
  // Metric users don't think in ounces: leave oz out of the line for them.
  const equivalents = useMemo(
    () =>
      equivalentAmounts(model, value.amount, value.unitId).filter(
        (eq) => !(weightUnits === 'kg' && eq.unitId === 'oz')
      ),
    [model, value.amount, value.unitId, weightUnits]
  );

  const setAmount = (amount: string) => onChange({ ...value, amount });
  const setUnit = (unitId: string) => onChange({ ...value, unitId });

  const currentAmount = parseFloat(value.amount);

  return (
    <div className="space-y-3">
      <label className="block text-subhead font-medium text-ink-2">Amount</label>

      {/* − amount + stepper, then the unit selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAmount(stepAmount(value.amount, unit, -1).toString())}
          aria-label="Less"
          data-testid={`${testIdPrefix}-step-down`}
          className="flex-shrink-0 w-11 rounded-lg bg-card text-ink flex items-center justify-center shadow-card hover:bg-fill transition-colors"
        >
          <IconMinus size={18} aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value.amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
          data-testid={`${testIdPrefix}-amount`}
          className="flex-1 min-w-0 px-3 py-2.5 text-headline font-medium text-center bg-card rounded-lg text-ink focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent shadow-card"
        />
        <button
          type="button"
          onClick={() => setAmount(stepAmount(value.amount, unit, 1).toString())}
          aria-label="More"
          data-testid={`${testIdPrefix}-step-up`}
          className="flex-shrink-0 w-11 rounded-lg bg-card text-ink flex items-center justify-center shadow-card hover:bg-fill transition-colors"
        >
          <IconPlus size={18} aria-hidden="true" />
        </button>
        {model.units.length > 1 ? (
          <select
            value={value.unitId}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
            data-testid={`${testIdPrefix}-unit`}
            className="px-3 py-2.5 bg-card rounded-lg text-ink text-subhead focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent shadow-card"
          >
            {model.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="flex items-center px-3 text-subhead text-ink-2 whitespace-nowrap"
            data-testid={`${testIdPrefix}-unit`}
          >
            {unit.label}
          </span>
        )}
      </div>

      {/* Serving-weight helper text (keeps grams out of the ambiguous label) */}
      {servingGramsHint && (
        <p className="text-caption text-ink-3" data-testid={`${testIdPrefix}-serving-hint`}>
          <span className="text-ink-2 font-medium">{servingGramsHint}</span>
          {model.units.some((u) => u.kind === 'weight') && (
            <span> · switch the unit to enter grams</span>
          )}
        </p>
      )}

      {/* The same amount in everyday units, one tap to switch to it */}
      {equivalents.length > 0 && (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-2"
          data-testid={`${testIdPrefix}-equivalents`}
        >
          <span>Same as</span>
          {equivalents.map((eq, i) => (
            <span key={eq.unitId} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">·</span>}
              <button
                type="button"
                onClick={() => onChange({ amount: eq.amount.toString(), unitId: eq.unitId })}
                aria-label={`Switch to ${eq.label}`}
                className="font-medium text-action hover:underline"
              >
                {eq.label}
              </button>
            </span>
          ))}
        </p>
      )}

      {/* Quick-amount chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={`${testIdPrefix}-chips`}>
          {chips.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAmount(amt.toString())}
              className={`py-1.5 px-3 rounded-lg text-subhead font-medium transition-colors ${
                currentAmount === amt
                  ? 'bg-action text-on-action'
                  : 'bg-fill text-ink-2 hover:bg-sep'
              }`}
            >
              {chipLabel(model, value.unitId, amt)}
            </button>
          ))}
        </div>
      )}

      {/* Live macro preview */}
      {!hidePreview && (
        <div
          className="grid grid-cols-4 gap-2 text-subhead p-3 bg-card/50 rounded-lg"
          data-testid={`${testIdPrefix}-preview`}
        >
          <div className="text-center">
            <p className="text-title font-bold text-ink" data-testid={`${testIdPrefix}-preview-calories`}>
              {preview.macros.calories}
            </p>
            <p className="text-caption text-ink-2">Calories</p>
          </div>
          <div className="text-center">
            <p className="text-headline font-medium text-ink">{preview.macros.protein}g</p>
            <p className="text-caption text-ink-2">Protein</p>
          </div>
          <div className="text-center">
            <p className="text-headline font-medium text-ink">{preview.macros.carbs}g</p>
            <p className="text-caption text-ink-2">Carbs</p>
          </div>
          <div className="text-center">
            <p className="text-headline font-medium text-ink">{preview.macros.fat}g</p>
            <p className="text-caption text-ink-2">Fat</p>
          </div>
        </div>
      )}
    </div>
  );
}

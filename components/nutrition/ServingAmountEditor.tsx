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
  getUnit,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';

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
}: ServingAmountEditorProps) {
  const unit = getUnit(model, value.unitId);

  const preview = useMemo(
    () => computeServing(model, value.amount, value.unitId),
    [model, value.amount, value.unitId]
  );

  // Default chips for the current unit, plus the user's recent distinct
  // amounts (deduped, last-2-first), so one tap beats typing on mobile.
  const chips = useMemo(() => {
    const base = unit.kind === 'weight' ? model.quickChips : model.quickChips;
    const merged: number[] = [...base];
    for (const amt of recentAmounts) {
      if (!merged.includes(amt)) merged.push(amt);
    }
    return merged;
  }, [unit.kind, model.quickChips, recentAmounts]);

  const setAmount = (amount: string) => onChange({ ...value, amount });
  const setUnit = (unitId: string) => onChange({ ...value, unitId });

  const currentAmount = parseFloat(value.amount);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-surface-300">Amount</label>

      {/* Amount input + unit selector */}
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value.amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
          data-testid={`${testIdPrefix}-amount`}
          className="flex-1 min-w-0 px-4 py-2.5 text-lg font-medium bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        {model.units.length > 1 ? (
          <select
            value={value.unitId}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
            data-testid={`${testIdPrefix}-unit`}
            className="px-3 py-2.5 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {model.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="flex items-center px-3 text-sm text-surface-400 whitespace-nowrap"
            data-testid={`${testIdPrefix}-unit`}
          >
            {unit.label}
          </span>
        )}
      </div>

      {/* Quick-amount chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={`${testIdPrefix}-chips`}>
          {chips.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAmount(amt.toString())}
              className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                currentAmount === amt
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
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
          className="grid grid-cols-4 gap-2 text-sm p-3 bg-surface-900/50 rounded-lg"
          data-testid={`${testIdPrefix}-preview`}
        >
          <div className="text-center">
            <p className="text-2xl font-bold text-surface-100" data-testid={`${testIdPrefix}-preview-calories`}>
              {preview.macros.calories}
            </p>
            <p className="text-xs text-surface-400">Calories</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-surface-100">{preview.macros.protein}g</p>
            <p className="text-xs text-surface-400">Protein</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-surface-100">{preview.macros.carbs}g</p>
            <p className="text-xs text-surface-400">Carbs</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-surface-100">{preview.macros.fat}g</p>
            <p className="text-xs text-surface-400">Fat</p>
          </div>
        </div>
      )}
    </div>
  );
}

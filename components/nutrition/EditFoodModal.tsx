'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui';
import type { FoodLogEntry } from '@/types/nutrition';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { ServingAmountEditor, type ServingAmountValue } from './ServingAmountEditor';
import {
  computeServing,
  perServingModel,
  parseServingWeight,
  initialAmountForEntry,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';
import {
  foodKeyFor,
  getRecentAmounts,
  recordLastUsedServing,
} from '@/lib/nutrition/lastUsedServing';

export interface EditFoodUpdates {
  servings: number;
  /** Round-trippable portion string (e.g. "180g", "1 serving (85g)"). Persisted
   * so a re-edit recovers the same grams-per-serving and shows the amount as
   * entered — never derived from a stale serving_size + a new servings count. */
  servingSize: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Present when the user hand-corrected the per-serving nutrition.
   * The parent should also update the cached/custom food record so
   * future logs of this product use the corrected values. */
  perServing?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

interface EditFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: EditFoodUpdates) => Promise<void>;
  onDelete: (id: string) => void;
  entry: FoodLogEntry | null;
}

export function EditFoodModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  entry,
}: EditFoodModalProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);
  const [amountValue, setAmountValue] = useState<ServingAmountValue>({ amount: '1', unitId: 'serving' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Per-serving nutrition editing (fix incomplete barcode-lookup data)
  const [showNutritionEditor, setShowNutritionEditor] = useState(false);
  const [macrosDirty, setMacrosDirty] = useState(false);
  const [editedMacros, setEditedMacros] = useState({
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });

  // Grams-per-serving parsed from the logged serving_size (the string encodes
  // the whole logged portion, so divide by logged servings).
  const perServingGrams = useMemo(() => {
    const { grams } = parseServingWeight(entry?.serving_size);
    const servings = entry?.servings || 1;
    return grams != null && grams > 0 ? grams / servings : null;
  }, [entry?.serving_size, entry?.servings]);

  // Effective per-serving nutrition: user edits (from the fix-nutrition editor)
  // take precedence over the logged values (totals ÷ logged servings), so the
  // shared editor scales the corrected values. Memoised so it can key model.
  const baseNutrition = useMemo(() => {
    if (macrosDirty) {
      return {
        calories: parseFloat(editedMacros.calories) || 0,
        protein: parseFloat(editedMacros.protein) || 0,
        carbs: parseFloat(editedMacros.carbs) || 0,
        fat: parseFloat(editedMacros.fat) || 0,
      };
    }
    const servings = entry?.servings || 1;
    return {
      calories: (entry?.calories || 0) / servings,
      protein: (entry?.protein || 0) / servings,
      carbs: (entry?.carbs || 0) / servings,
      fat: (entry?.fat || 0) / servings,
    };
  }, [macrosDirty, editedMacros, entry]);

  // Data-quality checks on the current per-serving values
  const macroSum = baseNutrition.protein + baseNutrition.carbs + baseNutrition.fat;
  const looksIncomplete = baseNutrition.calories > 50 && macroSum === 0;
  const macroCalories = 4 * baseNutrition.protein + 4 * baseNutrition.carbs + 9 * baseNutrition.fat;
  const macrosMismatchCalories =
    !looksIncomplete &&
    baseNutrition.calories > 0 &&
    macroSum > 0 &&
    Math.abs(macroCalories - baseNutrition.calories) / baseNutrition.calories > 0.25;

  // The same model the add sheet builds, so the controls render identically.
  const model: FoodAmountModel = useMemo(
    () => perServingModel(baseNutrition, 'serving', perServingGrams),
    [baseNutrition, perServingGrams]
  );

  const foodKey = entry ? foodKeyFor({ foodId: entry.food_id, name: entry.food_name }) : '';
  const recentAmounts = useMemo(
    () => (foodKey ? getRecentAmounts(foodKey, amountValue.unitId, 2) : []),
    [foodKey, amountValue.unitId]
  );

  const result = useMemo(
    () => computeServing(model, amountValue.amount, amountValue.unitId),
    [model, amountValue.amount, amountValue.unitId]
  );

  // Reset form when entry changes
  useEffect(() => {
    if (entry) {
      // Reopen showing the amount/unit as it was logged (grams stay grams),
      // not always coerced to a servings count.
      setAmountValue(initialAmountForEntry(entry.serving_size, entry.servings));
      const entryServings = entry.servings || 1;
      setEditedMacros({
        calories: Math.round((entry.calories || 0) / entryServings).toString(),
        protein: (Math.round(((entry.protein || 0) / entryServings) * 10) / 10).toString(),
        carbs: (Math.round(((entry.carbs || 0) / entryServings) * 10) / 10).toString(),
        fat: (Math.round(((entry.fat || 0) / entryServings) * 10) / 10).toString(),
      });
      setMacrosDirty(false);
      setShowNutritionEditor(false);
      setError('');
    }
  }, [entry]);

  if (!isOpen || !entry) return null;

  const handleSave = async () => {
    const amountNum = parseFloat(amountValue.amount);
    if (!amountNum || amountNum <= 0 || result.servings <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave(entry.id, {
        servings: result.servings,
        servingSize: result.servingSize,
        calories: result.macros.calories,
        protein: result.macros.protein,
        carbs: result.macros.carbs,
        fat: result.macros.fat,
        ...(macrosDirty
          ? {
              perServing: {
                calories: Math.round(baseNutrition.calories),
                protein: Math.round(baseNutrition.protein * 10) / 10,
                carbs: Math.round(baseNutrition.carbs * 10) / 10,
                fat: Math.round(baseNutrition.fat * 10) / 10,
              },
            }
          : {}),
      });
      recordLastUsedServing(foodKey, amountNum, amountValue.unitId);
      onClose();
    } catch (err) {
      setError('Failed to update food entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  // No confirm dialog: deletion shows an Undo toast, so it's recoverable
  const handleDelete = () => {
    onDelete(entry.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      style={{
        // Re-center above the on-screen keyboard; safe-area stays additive.
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`,
      }}
    >
      <div
        ref={scrollContainerRef}
        className="bg-surface-900 border border-surface-700 rounded-xl max-w-md w-full overflow-y-auto shadow-xl"
        style={{ maxHeight: `min(90vh, calc(100vh - 2rem - ${keyboardInset}px))` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-800">
          <h2 className="text-lg font-semibold text-surface-100">Edit Food</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5">
          {/* Food Info */}
          <div className="p-4 bg-surface-800/50 rounded-lg">
            <h3 className="font-medium text-surface-100 text-lg">{entry.food_name}</h3>
            <p className="text-sm text-surface-400 mt-1">
              {entry.serving_size || '1 serving'}
            </p>
            <div className="flex items-center justify-between gap-2 mt-2">
              <p className="text-xs text-surface-500" data-testid="edit-food-per-serving">
                Per serving: {Math.round(baseNutrition.calories)} cal ·
                P: {Math.round(baseNutrition.protein)}g ·
                C: {Math.round(baseNutrition.carbs)}g ·
                F: {Math.round(baseNutrition.fat)}g
              </p>
              <button
                onClick={() => setShowNutritionEditor((prev) => !prev)}
                aria-label="Edit nutrition"
                aria-expanded={showNutritionEditor}
                className={`p-1.5 rounded-md flex-shrink-0 transition-colors ${
                  showNutritionEditor
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
            {macrosMismatchCalories && (
              <p className="text-[11px] text-warning-400/80 mt-1.5">
                Heads up: these macros don&apos;t quite match the calories.
              </p>
            )}
          </div>

          {/* Incomplete-data warning (e.g. barcode lookup returned calories but no macros) */}
          {looksIncomplete && !showNutritionEditor && (
            <button
              onClick={() => setShowNutritionEditor(true)}
              className="w-full p-3 bg-warning-500/10 border border-warning-500/30 rounded-lg text-left hover:bg-warning-500/15 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-warning-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-warning-400">
                  This entry looks incomplete — tap to edit nutrition.
                </p>
              </div>
            </button>
          )}

          {/* Per-serving nutrition editor */}
          {showNutritionEditor && (
            <div className="p-4 bg-surface-800/50 border border-surface-700 rounded-lg space-y-3">
              <p className="text-sm font-medium text-surface-300">
                Edit nutrition <span className="text-surface-500 font-normal">(per serving)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'calories', label: 'Calories', step: '1' },
                  { key: 'protein', label: 'Protein (g)', step: '0.1' },
                  { key: 'carbs', label: 'Carbs (g)', step: '0.1' },
                  { key: 'fat', label: 'Fat (g)', step: '0.1' },
                ] as const).map(({ key, label, step }) => (
                  <div key={key}>
                    <label className="block text-xs text-surface-500 mb-1">{label}</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={step}
                      min="0"
                      value={editedMacros[key]}
                      onChange={(e) => {
                        setMacrosDirty(true);
                        setEditedMacros((prev) => ({ ...prev, [key]: e.target.value }));
                      }}
                      className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-surface-500">
                Corrections are saved to this food, so future logs use the updated values.
              </p>
            </div>
          )}

          {/* Shared AMOUNT + UNIT editor — identical to the add sheet */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              How much did you have?
            </label>
            <ServingAmountEditor
              model={model}
              value={amountValue}
              onChange={setAmountValue}
              recentAmounts={recentAmounts}
              hidePreview
              testIdPrefix="edit-food"
            />
          </div>

          {/* Updated Nutrition */}
          <div className="p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg">
            <p className="text-sm font-medium text-primary-400 mb-3">Updated Nutrition</p>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold text-surface-100" data-testid="edit-food-calories">{result.macros.calories}</div>
                <div className="text-xs text-surface-400">Calories</div>
              </div>
              <div>
                <div className="text-xl font-bold text-accent-400">{result.macros.protein}g</div>
                <div className="text-xs text-surface-400">Protein</div>
              </div>
              <div>
                <div className="text-xl font-bold text-warning-400">{result.macros.carbs}g</div>
                <div className="text-xs text-surface-400">Carbs</div>
              </div>
              <div>
                <div className="text-xl font-bold text-danger-400">{result.macros.fat}g</div>
                <div className="text-xs text-surface-400">Fat</div>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-surface-800">
          <button
            onClick={handleDelete}
            className="text-danger-400 hover:text-danger-300 text-sm flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              isLoading={isSubmitting}
              disabled={result.servings <= 0}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

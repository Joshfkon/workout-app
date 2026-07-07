'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button, Input } from '@/components/ui';
import type { FoodLogEntry } from '@/types/nutrition';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

export interface EditFoodUpdates {
  servings: number;
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

// Parse weight from serving_size string like "1 portion (85.048 g)" or "100g"
function parseServingWeight(servingSize: string | null | undefined): { grams: number | null; unit: string } {
  if (!servingSize) return { grams: null, unit: '' };
  
  // Try to match patterns like "(85.048 g)", "(100g)", "100 g", "3 oz"
  const gramMatch = servingSize.match(/\(?([\d.]+)\s*g(?:rams?)?\)?/i);
  if (gramMatch) {
    return { grams: parseFloat(gramMatch[1]), unit: 'g' };
  }
  
  const ozMatch = servingSize.match(/\(?([\d.]+)\s*oz(?:ounces?)?\)?/i);
  if (ozMatch) {
    return { grams: parseFloat(ozMatch[1]) * 28.3495, unit: 'oz' };
  }
  
  return { grams: null, unit: '' };
}

type InputMode = 'servings' | 'weight';
type WeightUnit = 'g' | 'oz';

export function EditFoodModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  entry,
}: EditFoodModalProps) {
  const { inset: keyboardInset, scrollContainerRef } =
    useKeyboardInset<HTMLDivElement>(isOpen);
  const [servings, setServings] = useState('1');
  const [inputMode, setInputMode] = useState<InputMode>('servings');
  const [weightValue, setWeightValue] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
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

  // Parse weight info from serving_size
  const servingWeightInfo = useMemo(() => {
    return parseServingWeight(entry?.serving_size);
  }, [entry?.serving_size]);

  const hasWeightInfo = servingWeightInfo.grams !== null && servingWeightInfo.grams > 0;

  // Original per-serving nutrition (logged values divided by logged servings)
  const originalNutrition = entry ? {
    calories: (entry.calories || 0) / (entry.servings || 1),
    protein: (entry.protein || 0) / (entry.servings || 1),
    carbs: (entry.carbs || 0) / (entry.servings || 1),
    fat: (entry.fat || 0) / (entry.servings || 1),
  } : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  // Effective per-serving nutrition: user edits take precedence, so the
  // serving-multiplier logic below scales the corrected values
  const baseNutrition = macrosDirty ? {
    calories: parseFloat(editedMacros.calories) || 0,
    protein: parseFloat(editedMacros.protein) || 0,
    carbs: parseFloat(editedMacros.carbs) || 0,
    fat: parseFloat(editedMacros.fat) || 0,
  } : originalNutrition;

  // Data-quality checks on the current per-serving values
  const macroSum = baseNutrition.protein + baseNutrition.carbs + baseNutrition.fat;
  const looksIncomplete = baseNutrition.calories > 50 && macroSum === 0;
  const macroCalories = 4 * baseNutrition.protein + 4 * baseNutrition.carbs + 9 * baseNutrition.fat;
  const macrosMismatchCalories =
    !looksIncomplete &&
    baseNutrition.calories > 0 &&
    macroSum > 0 &&
    Math.abs(macroCalories - baseNutrition.calories) / baseNutrition.calories > 0.25;

  // Calculate effective servings based on input mode
  const effectiveServings = useMemo(() => {
    if (inputMode === 'servings') {
      return parseFloat(servings) || 0;
    } else if (hasWeightInfo && servingWeightInfo.grams) {
      // Convert weight input to servings
      const weightInGrams = weightUnit === 'oz' 
        ? (parseFloat(weightValue) || 0) * 28.3495 
        : (parseFloat(weightValue) || 0);
      return weightInGrams / servingWeightInfo.grams;
    }
    return 0;
  }, [inputMode, servings, weightValue, weightUnit, hasWeightInfo, servingWeightInfo.grams]);

  // Calculate new nutrition based on effective servings
  const newNutrition = {
    calories: Math.round(baseNutrition.calories * effectiveServings),
    protein: Math.round(baseNutrition.protein * effectiveServings * 10) / 10,
    carbs: Math.round(baseNutrition.carbs * effectiveServings * 10) / 10,
    fat: Math.round(baseNutrition.fat * effectiveServings * 10) / 10,
  };

  // Reset form when entry changes
  useEffect(() => {
    if (entry) {
      setServings((entry.servings || 1).toString());
      setInputMode('servings');
      // Initialize weight value based on serving weight
      if (servingWeightInfo.grams) {
        setWeightValue(Math.round(servingWeightInfo.grams * (entry.servings || 1)).toString());
      }
      // Seed the nutrition editor with the entry's per-serving values
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
  }, [entry, servingWeightInfo.grams]);

  if (!isOpen || !entry) return null;

  const handleSave = async () => {
    if (effectiveServings <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave(entry.id, {
        servings: effectiveServings,
        calories: newNutrition.calories,
        protein: newNutrition.protein,
        carbs: newNutrition.carbs,
        fat: newNutrition.fat,
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

  // Quick portion buttons
  const quickPortions = [0.25, 0.5, 0.75, 1, 1.5, 2];

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
              <p className="text-xs text-surface-500">
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

          {/* Input Mode Toggle */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              How much did you have?
            </label>
            
            {/* Mode toggle - only show if we have weight info */}
            {hasWeightInfo && (
              <div className="flex gap-1 p-1 bg-surface-800 rounded-lg mb-3">
                <button
                  onClick={() => setInputMode('servings')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    inputMode === 'servings'
                      ? 'bg-primary-500 text-white'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  Servings
                </button>
                <button
                  onClick={() => setInputMode('weight')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    inputMode === 'weight'
                      ? 'bg-primary-500 text-white'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  By Weight
                </button>
              </div>
            )}

            {inputMode === 'servings' ? (
              <>
                {/* Quick portion buttons */}
                <div className="grid grid-cols-6 gap-2 mb-3">
                  {quickPortions.map((portion) => (
                    <button
                      key={portion}
                      onClick={() => setServings(portion.toString())}
                      className={`py-2 px-1 rounded-lg text-sm font-medium transition-all ${
                        parseFloat(servings) === portion
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                      }`}
                    >
                      {portion === 0.25 ? '¼' : portion === 0.5 ? '½' : portion === 0.75 ? '¾' : `${portion}×`}
                    </button>
                  ))}
                </div>

                {/* Custom servings input */}
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={servings}
                    onChange={(e) => setServings(e.target.value)}
                    className="flex-1 px-4 py-3 text-lg font-medium text-center bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-surface-400 text-sm whitespace-nowrap">servings</span>
                </div>
              </>
            ) : (
              <>
                {/* Weight input */}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={weightValue}
                    onChange={(e) => setWeightValue(e.target.value)}
                    placeholder="Enter weight"
                    className="flex-1 px-4 py-3 text-lg font-medium text-center bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {/* Unit toggle */}
                  <div className="flex gap-1 p-1 bg-surface-800 rounded-lg">
                    <button
                      onClick={() => {
                        if (weightUnit === 'oz' && weightValue) {
                          // Convert oz to g
                          setWeightValue(Math.round(parseFloat(weightValue) * 28.3495).toString());
                        }
                        setWeightUnit('g');
                      }}
                      className={`py-2 px-3 rounded-md text-sm font-medium transition-all ${
                        weightUnit === 'g'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      g
                    </button>
                    <button
                      onClick={() => {
                        if (weightUnit === 'g' && weightValue) {
                          // Convert g to oz
                          setWeightValue((parseFloat(weightValue) / 28.3495).toFixed(1));
                        }
                        setWeightUnit('oz');
                      }}
                      className={`py-2 px-3 rounded-md text-sm font-medium transition-all ${
                        weightUnit === 'oz'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      oz
                    </button>
                  </div>
                </div>

                {/* Quick weight buttons */}
                <div className="flex flex-wrap gap-2">
                  {(weightUnit === 'g' ? [50, 100, 150, 200, 250, 300] : [1, 2, 3, 4, 6, 8]).map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setWeightValue(amount.toString())}
                      className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        parseFloat(weightValue) === amount
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                      }`}
                    >
                      {amount}{weightUnit}
                    </button>
                  ))}
                </div>

                {/* Show equivalent servings */}
                {effectiveServings > 0 && (
                  <p className="text-xs text-surface-500 mt-2 text-center">
                    ≈ {effectiveServings.toFixed(2)} servings
                  </p>
                )}
              </>
            )}
          </div>

          {/* Updated Nutrition */}
          <div className="p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg">
            <p className="text-sm font-medium text-primary-400 mb-3">Updated Nutrition</p>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold text-surface-100">{newNutrition.calories}</div>
                <div className="text-xs text-surface-400">Calories</div>
              </div>
              <div>
                <div className="text-xl font-bold text-accent-400">{newNutrition.protein}g</div>
                <div className="text-xs text-surface-400">Protein</div>
              </div>
              <div>
                <div className="text-xl font-bold text-warning-400">{newNutrition.carbs}g</div>
                <div className="text-xs text-surface-400">Carbs</div>
              </div>
              <div>
                <div className="text-xl font-bold text-danger-400">{newNutrition.fat}g</div>
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
              disabled={effectiveServings <= 0}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


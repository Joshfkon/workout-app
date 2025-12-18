'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button, Input } from '@/components/ui';
import type { FoodLogEntry } from '@/types/nutrition';

interface EditFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: { servings: number; calories: number; protein: number; carbs: number; fat: number }) => Promise<void>;
  onDelete: (id: string) => void;
  entry: FoodLogEntry | null;
}

// Parse weight from serving_size string like "1 portion (85.048 g)" or "100g"
function parseServingWeight(servingSize: string | undefined): { grams: number | null; unit: string } {
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
  const [servings, setServings] = useState('1');
  const [inputMode, setInputMode] = useState<InputMode>('servings');
  const [weightValue, setWeightValue] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('g');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Parse weight info from serving_size
  const servingWeightInfo = useMemo(() => {
    return parseServingWeight(entry?.serving_size);
  }, [entry?.serving_size]);
  
  const hasWeightInfo = servingWeightInfo.grams !== null && servingWeightInfo.grams > 0;

  // Calculate base nutrition per serving (original values divided by original servings)
  const baseNutrition = entry ? {
    calories: (entry.calories || 0) / (entry.servings || 1),
    protein: (entry.protein || 0) / (entry.servings || 1),
    carbs: (entry.carbs || 0) / (entry.servings || 1),
    fat: (entry.fat || 0) / (entry.servings || 1),
  } : { calories: 0, protein: 0, carbs: 0, fat: 0 };

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
      });
      onClose();
    } catch (err) {
      setError('Failed to update food entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (confirm('Delete this food entry?')) {
      onDelete(entry.id);
      onClose();
    }
  };

  // Quick portion buttons
  const quickPortions = [0.25, 0.5, 0.75, 1, 1.5, 2];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl">
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
            <p className="text-xs text-surface-500 mt-2">
              Per serving: {Math.round(baseNutrition.calories)} cal · 
              P: {Math.round(baseNutrition.protein)}g · 
              C: {Math.round(baseNutrition.carbs)}g · 
              F: {Math.round(baseNutrition.fat)}g
            </p>
          </div>

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


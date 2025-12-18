'use client';

import { useState, useEffect } from 'react';
import { Button, Input } from '@/components/ui';
import type { FoodLogEntry } from '@/types/nutrition';

interface EditFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: { servings: number; calories: number; protein: number; carbs: number; fat: number }) => Promise<void>;
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
  const [servings, setServings] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Calculate base nutrition per serving (original values divided by original servings)
  const baseNutrition = entry ? {
    calories: (entry.calories || 0) / (entry.servings || 1),
    protein: (entry.protein || 0) / (entry.servings || 1),
    carbs: (entry.carbs || 0) / (entry.servings || 1),
    fat: (entry.fat || 0) / (entry.servings || 1),
  } : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  // Calculate new nutrition based on new servings
  const servingsNum = parseFloat(servings) || 0;
  const newNutrition = {
    calories: Math.round(baseNutrition.calories * servingsNum),
    protein: Math.round(baseNutrition.protein * servingsNum * 10) / 10,
    carbs: Math.round(baseNutrition.carbs * servingsNum * 10) / 10,
    fat: Math.round(baseNutrition.fat * servingsNum * 10) / 10,
  };

  // Reset form when entry changes
  useEffect(() => {
    if (entry) {
      setServings((entry.servings || 1).toString());
      setError('');
    }
  }, [entry]);

  if (!isOpen || !entry) return null;

  const handleSave = async () => {
    const servingsValue = parseFloat(servings);
    if (isNaN(servingsValue) || servingsValue <= 0) {
      setError('Please enter a valid serving amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave(entry.id, {
        servings: servingsValue,
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

          {/* Servings Input */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              How much did you have?
            </label>
            
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

            {/* Custom input */}
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
              disabled={!servings || parseFloat(servings) <= 0}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


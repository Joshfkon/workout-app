'use client';

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { NutritionTargets } from '@/types/nutrition';

interface NutritionTargetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meals_per_day: number;
  }) => Promise<void>;
  existingTargets?: NutritionTargets;
}

export function NutritionTargetsModal({
  isOpen,
  onClose,
  onSave,
  existingTargets,
}: NutritionTargetsModalProps) {
  const [calories, setCalories] = useState(existingTargets?.calories?.toString() || '');
  const [protein, setProtein] = useState(existingTargets?.protein?.toString() || '');
  const [carbs, setCarbs] = useState(existingTargets?.carbs?.toString() || '');
  const [fat, setFat] = useState(existingTargets?.fat?.toString() || '');
  const [mealsPerDay, setMealsPerDay] = useState(existingTargets?.meals_per_day?.toString() || '3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const caloriesNum = parseFloat(calories);
    const proteinNum = parseFloat(protein);
    const carbsNum = parseFloat(carbs);
    const fatNum = parseFloat(fat);
    const mealsNum = parseInt(mealsPerDay) || 3;

    if (!caloriesNum || caloriesNum <= 0) {
      setError('Please enter a valid calorie target');
      return;
    }

    if (!proteinNum || proteinNum < 0) {
      setError('Please enter a valid protein target');
      return;
    }

    if (!carbsNum || carbsNum < 0) {
      setError('Please enter a valid carbs target');
      return;
    }

    if (!fatNum || fatNum < 0) {
      setError('Please enter a valid fat target');
      return;
    }

    if (mealsNum < 1 || mealsNum > 10) {
      setError('Please enter a valid number of meals (1-10)');
      return;
    }

    // Validate macros add up reasonably to calories (within 20% margin)
    const macroCalories = (proteinNum * 4) + (carbsNum * 4) + (fatNum * 9);
    const diff = Math.abs(macroCalories - caloriesNum);
    const diffPercent = (diff / caloriesNum) * 100;

    if (diffPercent > 20) {
      setError(
        `Warning: Your macros (${Math.round(macroCalories)} cal) don't match your calorie target. ` +
        `This is okay if intentional.`
      );
      // Don't return - allow submission with warning
    }

    setIsSubmitting(true);
    try {
      await onSave({
        calories: Math.round(caloriesNum),
        protein: Math.round(proteinNum * 10) / 10,
        carbs: Math.round(carbsNum * 10) / 10,
        fat: Math.round(fatNum * 10) / 10,
        meals_per_day: mealsNum,
      });
      onClose();
    } catch (err) {
      setError('Failed to save targets. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Set Nutrition Targets"
      description="Set your daily nutrition goals. You can adjust these anytime."
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="calories" className="block text-sm font-medium text-surface-300 mb-1">
                Calories
              </label>
              <Input
                id="calories"
                type="number"
                step="1"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="2000"
                required
                autoFocus
              />
              <p className="mt-1 text-xs text-surface-500">
                Daily calorie target
              </p>
            </div>

            <div>
              <label htmlFor="meals" className="block text-sm font-medium text-surface-300 mb-1">
                Meals per Day
              </label>
              <Input
                id="meals"
                type="number"
                min="1"
                max="10"
                value={mealsPerDay}
                onChange={(e) => setMealsPerDay(e.target.value)}
                placeholder="3"
              />
              <p className="mt-1 text-xs text-surface-500">
                For calorie suggestions
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="protein" className="block text-sm font-medium text-surface-300 mb-1">
              Protein (g)
            </label>
            <Input
              id="protein"
              type="number"
              step="0.1"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="150"
              required
            />
            <p className="mt-1 text-xs text-surface-500">
              {protein ? `${Math.round(parseFloat(protein) * 4)} calories (4 cal/g)` : '4 calories per gram'}
            </p>
          </div>

          <div>
            <label htmlFor="carbs" className="block text-sm font-medium text-surface-300 mb-1">
              Carbs (g)
            </label>
            <Input
              id="carbs"
              type="number"
              step="0.1"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              placeholder="200"
              required
            />
            <p className="mt-1 text-xs text-surface-500">
              {carbs ? `${Math.round(parseFloat(carbs) * 4)} calories (4 cal/g)` : '4 calories per gram'}
            </p>
          </div>

          <div>
            <label htmlFor="fat" className="block text-sm font-medium text-surface-300 mb-1">
              Fat (g)
            </label>
            <Input
              id="fat"
              type="number"
              step="0.1"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
              placeholder="65"
              required
            />
            <p className="mt-1 text-xs text-surface-500">
              {fat ? `${Math.round(parseFloat(fat) * 9)} calories (9 cal/g)` : '9 calories per gram'}
            </p>
          </div>

          {calories && protein && carbs && fat && (
            <div className="p-3 bg-surface-800 rounded-lg">
              <p className="text-sm text-surface-300">
                Macro breakdown: {Math.round((parseFloat(protein) * 4 / parseFloat(calories)) * 100)}% protein,{' '}
                {Math.round((parseFloat(carbs) * 4 / parseFloat(calories)) * 100)}% carbs,{' '}
                {Math.round((parseFloat(fat) * 9 / parseFloat(calories)) * 100)}% fat
              </p>
            </div>
          )}
        </div>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Targets'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

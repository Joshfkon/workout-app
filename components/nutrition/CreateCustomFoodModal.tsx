'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import type { CustomFood } from '@/types/nutrition';

interface CreateCustomFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (food: Omit<CustomFood, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  editingFood?: CustomFood | null;
}

export function CreateCustomFoodModal({
  isOpen,
  onClose,
  onSave,
  editingFood,
}: CreateCustomFoodModalProps) {
  const [isPerGram, setIsPerGram] = useState(editingFood?.is_per_gram ?? false);
  const [foodName, setFoodName] = useState(editingFood?.food_name ?? '');
  const [servingSize, setServingSize] = useState(editingFood?.serving_size ?? '1 serving');
  
  // Standard (per serving) values
  const [calories, setCalories] = useState(editingFood?.calories?.toString() ?? '');
  const [protein, setProtein] = useState(editingFood?.protein?.toString() ?? '');
  const [carbs, setCarbs] = useState(editingFood?.carbs?.toString() ?? '');
  const [fat, setFat] = useState(editingFood?.fat?.toString() ?? '');
  
  // Per 100g values
  const [caloriesPer100g, setCaloriesPer100g] = useState(editingFood?.calories_per_100g?.toString() ?? '');
  const [proteinPer100g, setProteinPer100g] = useState(editingFood?.protein_per_100g?.toString() ?? '');
  const [carbsPer100g, setCarbsPer100g] = useState(editingFood?.carbs_per_100g?.toString() ?? '');
  const [fatPer100g, setFatPer100g] = useState(editingFood?.fat_per_100g?.toString() ?? '');
  
  const [barcode, setBarcode] = useState(editingFood?.barcode ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!foodName.trim()) {
      setError('Please enter a food name');
      return;
    }

    if (isPerGram) {
      if (!caloriesPer100g) {
        setError('Please enter calories per 100g');
        return;
      }
    } else {
      if (!calories) {
        setError('Please enter calories');
        return;
      }
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave({
        food_name: foodName.trim(),
        serving_size: isPerGram ? 'per 100g' : servingSize,
        calories: isPerGram ? 0 : parseFloat(calories) || 0,
        protein: isPerGram ? null : parseFloat(protein) || null,
        carbs: isPerGram ? null : parseFloat(carbs) || null,
        fat: isPerGram ? null : parseFloat(fat) || null,
        is_per_gram: isPerGram,
        calories_per_100g: isPerGram ? parseFloat(caloriesPer100g) || null : null,
        protein_per_100g: isPerGram ? parseFloat(proteinPer100g) || null : null,
        carbs_per_100g: isPerGram ? parseFloat(carbsPer100g) || null : null,
        fat_per_100g: isPerGram ? parseFloat(fatPer100g) || null : null,
        barcode: barcode.trim() || null,
      });
      handleClose();
    } catch (err) {
      setError('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFoodName('');
    setServingSize('1 serving');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setCaloriesPer100g('');
    setProteinPer100g('');
    setCarbsPer100g('');
    setFatPer100g('');
    setBarcode('');
    setIsPerGram(false);
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editingFood ? 'Edit Custom Food' : 'Create Custom Food'}
      size="md"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Food Name */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1">
            Food Name *
          </label>
          <Input
            value={foodName}
            onChange={(e) => setFoodName(e.target.value)}
            placeholder="e.g., Homemade Granola"
          />
        </div>

        {/* Per-Gram Toggle */}
        <div className="flex items-center justify-between p-3 bg-surface-800 rounded-lg">
          <div>
            <p className="font-medium text-surface-200">Track by grams</p>
            <p className="text-xs text-surface-400">
              Enter nutrition per 100g, then log custom amounts
            </p>
          </div>
          <Toggle
            checked={isPerGram}
            onChange={(checked) => setIsPerGram(checked)}
            size="md"
          />
        </div>

        {isPerGram ? (
          /* Per 100g Entry */
          <div className="space-y-4 p-4 bg-surface-800/50 rounded-lg border border-surface-700">
            <p className="text-sm text-primary-400 font-medium">Nutrition per 100g</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Calories *
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={caloriesPer100g}
                  onChange={(e) => setCaloriesPer100g(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Protein (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={proteinPer100g}
                  onChange={(e) => setProteinPer100g(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Carbs (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={carbsPer100g}
                  onChange={(e) => setCarbsPer100g(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Fat (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={fatPer100g}
                  onChange={(e) => setFatPer100g(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
        ) : (
          /* Per Serving Entry */
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Serving Size
              </label>
              <Input
                value={servingSize}
                onChange={(e) => setServingSize(e.target.value)}
                placeholder="e.g., 1 cup, 1 bar, 4 oz"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Calories *
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Protein (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Carbs (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={carbs}
                  onChange={(e) => setCarbs(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Fat (g)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={fat}
                  onChange={(e) => setFat(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
        )}

        {/* Optional Barcode */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1">
            Barcode (optional)
          </label>
          <Input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or enter barcode for quick lookup"
          />
          <p className="text-xs text-surface-500 mt-1">
            Link a barcode for quick scanning later
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Saving...' : editingFood ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


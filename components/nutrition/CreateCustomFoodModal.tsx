'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import type { CustomFood } from '@/types/nutrition';
import type { LabelScanPrefill } from './LabelScanner';

interface CreateCustomFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (food: Omit<CustomFood, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  editingFood?: CustomFood | null;
  /** Prefill the barcode field (barcode scan not-found flow) */
  initialBarcode?: string;
  /** Prefill macros + serving from a scanned nutrition label (Scan Label flow) */
  initialScan?: LabelScanPrefill | null;
}

/** Which create-form inputs a label scan fills, keyed to parser fields. */
type ScannedFormField = 'calories' | 'protein' | 'carbs' | 'fat' | 'servingSize';

const scanValue = (v: number | null): string => (v === null ? '' : String(v));

export function CreateCustomFoodModal({
  isOpen,
  onClose,
  onSave,
  editingFood,
  initialBarcode,
  initialScan,
}: CreateCustomFoodModalProps) {
  const [isPerWeight, setIsPerWeight] = useState(editingFood?.is_per_weight ?? false);
  const [foodName, setFoodName] = useState(editingFood?.food_name ?? '');
  const [servingSize, setServingSize] = useState(editingFood?.serving_size ?? '1 serving');
  
  // Standard (per serving) values
  const [calories, setCalories] = useState(editingFood?.calories?.toString() ?? '');
  const [protein, setProtein] = useState(editingFood?.protein?.toString() ?? '');
  const [carbs, setCarbs] = useState(editingFood?.carbs?.toString() ?? '');
  const [fat, setFat] = useState(editingFood?.fat?.toString() ?? '');
  
  // Per-weight reference values
  const [referenceAmount, setReferenceAmount] = useState(editingFood?.reference_amount?.toString() ?? '100');
  const [referenceUnit, setReferenceUnit] = useState<'g' | 'oz'>(editingFood?.reference_unit ?? 'g');
  const [caloriesPerRef, setCaloriesPerRef] = useState(editingFood?.calories_per_ref?.toString() ?? '');
  const [proteinPerRef, setProteinPerRef] = useState(editingFood?.protein_per_ref?.toString() ?? '');
  const [carbsPerRef, setCarbsPerRef] = useState(editingFood?.carbs_per_ref?.toString() ?? '');
  const [fatPerRef, setFatPerRef] = useState(editingFood?.fat_per_ref?.toString() ?? '');
  
  const [barcode, setBarcode] = useState(editingFood?.barcode ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when editingFood changes
  useEffect(() => {
    if (editingFood) {
      setIsPerWeight(editingFood.is_per_weight ?? false);
      setFoodName(editingFood.food_name ?? '');
      setServingSize(editingFood.serving_size ?? '1 serving');
      setCalories(editingFood.calories?.toString() ?? '');
      setProtein(editingFood.protein?.toString() ?? '');
      setCarbs(editingFood.carbs?.toString() ?? '');
      setFat(editingFood.fat?.toString() ?? '');
      setReferenceAmount(editingFood.reference_amount?.toString() ?? '100');
      setReferenceUnit(editingFood.reference_unit ?? 'g');
      setCaloriesPerRef(editingFood.calories_per_ref?.toString() ?? '');
      setProteinPerRef(editingFood.protein_per_ref?.toString() ?? '');
      setCarbsPerRef(editingFood.carbs_per_ref?.toString() ?? '');
      setFatPerRef(editingFood.fat_per_ref?.toString() ?? '');
      setBarcode(editingFood.barcode ?? '');
    }
  }, [editingFood]);

  // Prefill barcode from a not-found scan (only for new foods)
  useEffect(() => {
    if (isOpen && !editingFood && initialBarcode) {
      setBarcode(initialBarcode);
    }
  }, [isOpen, editingFood, initialBarcode]);

  // Prefill from a scanned nutrition label (only for new foods). Values are
  // NEVER saved silently — they land here for review, with scanned fields
  // marked and low-confidence ones highlighted.
  useEffect(() => {
    if (isOpen && !editingFood && initialScan) {
      const { fields } = initialScan;
      setIsPerWeight(false);
      if (fields.servingSizeText) setServingSize(fields.servingSizeText);
      setCalories(scanValue(fields.calories));
      setProtein(scanValue(fields.proteinG));
      setCarbs(scanValue(fields.totalCarbsG));
      setFat(scanValue(fields.totalFatG));
    }
  }, [isOpen, editingFood, initialScan]);

  /** 'high' | 'low' | null (null = not from a scan) for one form input. */
  const scanConfidenceFor = (field: ScannedFormField): 'high' | 'low' | null => {
    if (!initialScan || editingFood) return null;
    const { fields, fieldConfidence } = initialScan;
    switch (field) {
      case 'calories':
        return fields.calories === null ? null : fieldConfidence.calories ?? 'high';
      case 'protein':
        return fields.proteinG === null ? null : fieldConfidence.proteinG ?? 'high';
      case 'carbs':
        return fields.totalCarbsG === null ? null : fieldConfidence.totalCarbsG ?? 'high';
      case 'fat':
        return fields.totalFatG === null ? null : fieldConfidence.totalFatG ?? 'high';
      case 'servingSize':
        return fields.servingSizeText === null ? null : 'high';
    }
  };

  /** Amber highlight for low-confidence scanned values. */
  const scanInputClass = (field: ScannedFormField): string =>
    scanConfidenceFor(field) === 'low'
      ? 'border-warning-500 focus:ring-warning-500'
      : '';

  const ScanBadge = ({ field }: { field: ScannedFormField }) => {
    const confidence = scanConfidenceFor(field);
    if (!confidence) return null;
    return (
      <span
        className={`ml-1.5 inline-block align-middle text-[10px] font-medium px-1.5 py-0.5 rounded ${
          confidence === 'low'
            ? 'bg-warning-500/15 text-warning-400'
            : 'bg-primary-500/15 text-primary-400'
        }`}
        data-testid={`scan-badge-${field}`}
      >
        {confidence === 'low' ? 'Check' : 'Scanned'}
      </span>
    );
  };

  const handleSubmit = async () => {
    if (!foodName.trim()) {
      setError('Please enter a food name');
      return;
    }

    if (isPerWeight) {
      if (!caloriesPerRef || !referenceAmount) {
        setError('Please enter the reference amount and calories');
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
        serving_size: isPerWeight ? `per ${referenceAmount}${referenceUnit}` : servingSize,
        calories: isPerWeight ? 0 : parseFloat(calories) || 0,
        protein: isPerWeight ? null : parseFloat(protein) || null,
        carbs: isPerWeight ? null : parseFloat(carbs) || null,
        fat: isPerWeight ? null : parseFloat(fat) || null,
        is_per_weight: isPerWeight,
        reference_amount: isPerWeight ? parseFloat(referenceAmount) || null : null,
        reference_unit: isPerWeight ? referenceUnit : null,
        calories_per_ref: isPerWeight ? parseFloat(caloriesPerRef) || null : null,
        protein_per_ref: isPerWeight ? parseFloat(proteinPerRef) || null : null,
        carbs_per_ref: isPerWeight ? parseFloat(carbsPerRef) || null : null,
        fat_per_ref: isPerWeight ? parseFloat(fatPerRef) || null : null,
        barcode: barcode.trim() || null,
      });
      handleClose();
    } catch (err) {
      console.error('Failed to save custom food:', err);
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
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
    setReferenceAmount('100');
    setReferenceUnit('g');
    setCaloriesPerRef('');
    setProteinPerRef('');
    setCarbsPerRef('');
    setFatPerRef('');
    setBarcode('');
    setIsPerWeight(false);
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

        {/* Scanned-label review banner: values are prefilled, never auto-saved */}
        {initialScan && !editingFood && (
          <div
            className={`p-3 text-sm rounded-lg border space-y-1 ${
              initialScan.confidence === 'low' || initialScan.warnings.length > 0
                ? 'bg-warning-500/10 border-warning-500/20 text-warning-400'
                : 'bg-primary-500/10 border-primary-500/20 text-primary-400'
            }`}
            data-testid="label-scan-banner"
          >
            <p className="font-medium">
              {initialScan.source === 'ai' ? 'Read by AI scan' : 'Scanned from label'} — review before saving
            </p>
            {initialScan.warnings.map((warning) => (
              <p key={warning} className="text-xs opacity-90">
                {warning}
              </p>
            ))}
            <p className="text-xs opacity-75">Add a name of your own — brand names aren&apos;t scanned.</p>
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

        {/* Per-Weight Toggle */}
        <div className="flex items-center justify-between p-3 bg-surface-800 rounded-lg">
          <div>
            <p className="font-medium text-surface-200">Track by weight</p>
            <p className="text-xs text-surface-400">
              Enter nutrition per label amount, then weigh your portion
            </p>
          </div>
          <Toggle
            checked={isPerWeight}
            onChange={(checked) => setIsPerWeight(checked)}
            size="md"
          />
        </div>

        {isPerWeight ? (
          /* Per-Weight Entry */
          <div className="space-y-4 p-4 bg-surface-800/50 rounded-lg border border-surface-700">
            {/* Reference Amount */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Nutrition label is &quot;per...&quot;
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={referenceAmount}
                  onChange={(e) => setReferenceAmount(e.target.value)}
                  placeholder="28"
                  className="flex-1"
                />
                <select
                  value={referenceUnit}
                  onChange={(e) => setReferenceUnit(e.target.value as 'g' | 'oz')}
                  className="px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="g">grams (g)</option>
                  <option value="oz">ounces (oz)</option>
                </select>
              </div>
              <p className="text-xs text-surface-500 mt-1">
                Match the serving size on the food label (e.g., &quot;28g&quot;, &quot;100g&quot;, &quot;1 oz&quot;)
              </p>
            </div>

            {/* Nutrition per reference amount */}
            <p className="text-sm text-primary-400 font-medium">
              Nutrition per {referenceAmount || '?'}{referenceUnit}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Calories *
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={caloriesPerRef}
                  onChange={(e) => setCaloriesPerRef(e.target.value)}
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
                  value={proteinPerRef}
                  onChange={(e) => setProteinPerRef(e.target.value)}
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
                  value={carbsPerRef}
                  onChange={(e) => setCarbsPerRef(e.target.value)}
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
                  value={fatPerRef}
                  onChange={(e) => setFatPerRef(e.target.value)}
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
                <ScanBadge field="servingSize" />
              </label>
              <Input
                value={servingSize}
                onChange={(e) => setServingSize(e.target.value)}
                placeholder="e.g., 1 cup, 1 bar, 4 oz"
                data-testid="custom-food-serving-size"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Calories *
                  <ScanBadge field="calories" />
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  placeholder="0"
                  className={scanInputClass('calories')}
                  data-testid="custom-food-calories"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Protein (g)
                  <ScanBadge field="protein" />
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  placeholder="0"
                  className={scanInputClass('protein')}
                  data-testid="custom-food-protein"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Carbs (g)
                  <ScanBadge field="carbs" />
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={carbs}
                  onChange={(e) => setCarbs(e.target.value)}
                  placeholder="0"
                  className={scanInputClass('carbs')}
                  data-testid="custom-food-carbs"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Fat (g)
                  <ScanBadge field="fat" />
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={fat}
                  onChange={(e) => setFat(e.target.value)}
                  placeholder="0"
                  className={scanInputClass('fat')}
                  data-testid="custom-food-fat"
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

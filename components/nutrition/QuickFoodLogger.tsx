'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui';
import { BarcodeScanner } from './BarcodeScanner';
import type { BarcodeSearchResult } from '@/services/openFoodFactsService';
import type { FrequentFood, SystemFood, MealType } from '@/types/nutrition';

interface QuickFoodLoggerProps {
  onAdd: (food: {
    food_name: string;
    serving_size: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_type: MealType;
    source: 'usda' | 'manual' | 'barcode';
  }) => Promise<void>;
  onClose: () => void;
  frequentFoods?: FrequentFood[];
  systemFoods?: SystemFood[];
  defaultMealType?: MealType;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '🌅 Breakfast',
  lunch: '☀️ Lunch',
  dinner: '🌙 Dinner',
  snack: '🍎 Snack',
};

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  protein: { label: 'Proteins', emoji: '🥩' },
  carbs: { label: 'Carbs', emoji: '🍚' },
  fats: { label: 'Fats', emoji: '🥜' },
  vegetables: { label: 'Vegetables', emoji: '🥦' },
  fruits: { label: 'Fruits', emoji: '🍎' },
  supplements: { label: 'Supplements', emoji: '💪' },
};

export function QuickFoodLogger({ 
  onAdd, 
  onClose, 
  frequentFoods = [], 
  systemFoods = [],
  defaultMealType = 'lunch',
}: QuickFoodLoggerProps) {
  const [mode, setMode] = useState<'foods' | 'barcode' | 'manual'>('foods');
  const [query, setQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [selectedFood, setSelectedFood] = useState<SystemFood | null>(null);
  const [weightAmount, setWeightAmount] = useState('100');
  const [weightUnit, setWeightUnit] = useState<'g' | 'oz'>('g');

  // Manual entry state
  const [manualName, setManualName] = useState('');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  // Barcode product state
  const [barcodeProduct, setBarcodeProduct] = useState<NonNullable<BarcodeSearchResult['product']> | null>(null);

  // Get frequent foods for the selected meal type
  const frequentFoodsForMeal = useMemo(() => {
    return frequentFoods
      .filter(f => f.meal_type === mealType)
      .sort((a, b) => b.times_logged - a.times_logged)
      .slice(0, 5);
  }, [frequentFoods, mealType]);

  // Filter system foods based on search
  const filteredSystemFoods = useMemo(() => {
    if (!query.trim()) return systemFoods.slice(0, 15);
    const q = query.toLowerCase();
    return systemFoods.filter(f => f.name.toLowerCase().includes(q)).slice(0, 20);
  }, [systemFoods, query]);

  // Calculate nutrition for selected system food
  const calculatedNutrition = useMemo(() => {
    if (!selectedFood) return null;
    const inputAmount = parseFloat(weightAmount) || 0;
    const gramsAmount = weightUnit === 'oz' ? inputAmount * 28.3495 : inputAmount;
    const multiplier = gramsAmount / 100;
    return {
      calories: Math.round(selectedFood.calories_per_100g * multiplier),
      protein: Math.round(selectedFood.protein_per_100g * multiplier * 10) / 10,
      carbs: Math.round(selectedFood.carbs_per_100g * multiplier * 10) / 10,
      fat: Math.round(selectedFood.fat_per_100g * multiplier * 10) / 10,
    };
  }, [selectedFood, weightAmount, weightUnit]);

  const handleAddFrequentFood = async (food: FrequentFood) => {
    setIsAdding(true);
    try {
      await onAdd({
        food_name: food.food_name,
        serving_size: food.serving_size || '1 serving',
        servings: 1,
        calories: Math.round(food.avg_calories),
        protein: Math.round(food.avg_protein * 10) / 10,
        carbs: Math.round(food.avg_carbs * 10) / 10,
        fat: Math.round(food.avg_fat * 10) / 10,
        meal_type: mealType,
        source: 'manual',
      });
      onClose();
    } catch (error) {
      console.error('Failed to add food:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddSystemFood = async () => {
    if (!selectedFood || !calculatedNutrition) return;
    setIsAdding(true);
    try {
      const inputAmount = parseFloat(weightAmount) || 100;
      await onAdd({
        food_name: selectedFood.name,
        serving_size: `${inputAmount}${weightUnit}`,
        servings: 1,
        calories: calculatedNutrition.calories,
        protein: calculatedNutrition.protein,
        carbs: calculatedNutrition.carbs,
        fat: calculatedNutrition.fat,
        meal_type: mealType,
        source: 'manual',
      });
      onClose();
    } catch (error) {
      console.error('Failed to add food:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualName.trim() || !manualCalories) return;
    setIsAdding(true);
    try {
      await onAdd({
        food_name: manualName,
        serving_size: '1 serving',
        servings: 1,
        calories: parseInt(manualCalories) || 0,
        protein: parseFloat(manualProtein) || 0,
        carbs: parseFloat(manualCarbs) || 0,
        fat: parseFloat(manualFat) || 0,
        meal_type: mealType,
        source: 'manual',
      });
      onClose();
    } catch (error) {
      console.error('Failed to add food:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleBarcodeProduct = (product: NonNullable<BarcodeSearchResult['product']>) => {
    try {
      console.log('[QuickFoodLogger] Product received:', product?.name);
      setBarcodeProduct(product);
    } catch (err) {
      console.error('[QuickFoodLogger] Error setting product:', err);
    }
  };

  const handleAddBarcodeProduct = async () => {
    if (!barcodeProduct) return;
    setIsAdding(true);
    try {
      await onAdd({
        food_name: barcodeProduct.name,
        serving_size: barcodeProduct.servingSize,
        servings: 1,
        calories: barcodeProduct.calories,
        protein: barcodeProduct.protein,
        carbs: barcodeProduct.carbs,
        fat: barcodeProduct.fat,
        meal_type: mealType,
        source: 'barcode',
      });
      onClose();
    } catch (error) {
      console.error('Failed to add food:', error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="p-4 bg-surface-800 rounded-xl border border-surface-700 space-y-4">
      {/* Meal Type Selector */}
      <div className="flex gap-1 bg-surface-900 p-1 rounded-lg">
        {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
          <button
            key={type}
            onClick={() => {
              setMealType(type);
              setSelectedFood(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors capitalize ${
              mealType === type
                ? 'bg-primary-500 text-white'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-1 bg-surface-900 p-1 rounded-lg">
        <button
          onClick={() => { setMode('foods'); setBarcodeProduct(null); setSelectedFood(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'foods'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          ⚡ Quick Add
        </button>
        <button
          onClick={() => { setMode('barcode'); setBarcodeProduct(null); setSelectedFood(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'barcode'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          📷 Scan
        </button>
        <button
          onClick={() => { setMode('manual'); setBarcodeProduct(null); setSelectedFood(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'manual'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          ✏️ Manual
        </button>
      </div>

      {mode === 'foods' ? (
        <>
          {/* Search Input */}
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedFood(null); }}
            placeholder="Search foods..."
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder-surface-500"
          />

          {selectedFood ? (
            /* Selected Food - Weight Entry */
            <div className="space-y-3 p-3 bg-surface-900 rounded-lg">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-surface-100">{selectedFood.name}</p>
                  <p className="text-xs text-surface-400">{selectedFood.calories_per_100g} cal per 100g</p>
                </div>
                <button
                  onClick={() => setSelectedFood(null)}
                  className="text-surface-400 hover:text-surface-200 text-lg"
                >
                  ×
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  value={weightAmount}
                  onChange={(e) => setWeightAmount(e.target.value)}
                  placeholder="100"
                  className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100"
                />
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value as 'g' | 'oz')}
                  className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100"
                >
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                </select>
              </div>

              {calculatedNutrition && (
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-surface-100">{calculatedNutrition.calories}</p>
                    <p className="text-surface-500">cal</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-red-400">{calculatedNutrition.protein}g</p>
                    <p className="text-surface-500">protein</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-yellow-400">{calculatedNutrition.carbs}g</p>
                    <p className="text-surface-500">carbs</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-blue-400">{calculatedNutrition.fat}g</p>
                    <p className="text-surface-500">fat</p>
                  </div>
                </div>
              )}

              <Button
                onClick={handleAddSystemFood}
                isLoading={isAdding}
                className="w-full"
              >
                Add to {mealType}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {/* Frequent Foods for this Meal */}
              {!query && frequentFoodsForMeal.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2">
                    Your {MEAL_LABELS[mealType].split(' ')[1]} favorites
                  </p>
                  <div className="space-y-1">
                    {frequentFoodsForMeal.map((food, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAddFrequentFood(food)}
                        disabled={isAdding}
                        className="w-full p-2 bg-surface-900 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center disabled:opacity-50"
                      >
                        <div>
                          <p className="text-sm font-medium text-surface-200">{food.food_name}</p>
                          <p className="text-xs text-surface-500">
                            {Math.round(food.avg_calories)} cal · {food.times_logged}x
                          </p>
                        </div>
                        <span className="text-primary-400 text-xs">+ Add</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* System Foods */}
              {filteredSystemFoods.length > 0 && (
                <div>
                  {!query && <p className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2">All Foods</p>}
                  <div className="space-y-1">
                    {filteredSystemFoods.map((food) => (
                      <button
                        key={food.id}
                        onClick={() => { setSelectedFood(food); setWeightAmount('100'); }}
                        className="w-full p-2 bg-surface-900 hover:bg-surface-700 rounded-lg text-left transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-surface-200">{food.name}</span>
                          <span className="text-xs text-surface-500">
                            {food.calories_per_100g} cal | {food.protein_per_100g}g P
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {query && filteredSystemFoods.length === 0 && (
                <p className="text-center text-surface-400 py-4 text-sm">No foods found</p>
              )}
            </div>
          )}
        </>
      ) : mode === 'barcode' ? (
        /* Barcode Scanner Mode */
        barcodeProduct ? (
          /* Show scanned product for confirmation */
          <div className="space-y-3">
            <div className="p-4 bg-surface-900 rounded-lg">
              {barcodeProduct.imageUrl && (
                <div className="flex justify-center mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={barcodeProduct.imageUrl} 
                    alt={barcodeProduct.name}
                    className="h-20 w-20 object-contain rounded-lg bg-white"
                  />
                </div>
              )}
              <h3 className="text-sm font-medium text-surface-100 text-center">{barcodeProduct.name}</h3>
              <p className="text-xs text-surface-400 text-center mt-1">{barcodeProduct.servingSize}</p>
              
              <div className="grid grid-cols-4 gap-2 mt-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-primary-400">{barcodeProduct.calories}</p>
                  <p className="text-xs text-surface-500">cal</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-red-400">{barcodeProduct.protein}g</p>
                  <p className="text-xs text-surface-500">protein</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-yellow-400">{barcodeProduct.carbs}g</p>
                  <p className="text-xs text-surface-500">carbs</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-blue-400">{barcodeProduct.fat}g</p>
                  <p className="text-xs text-surface-500">fat</p>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                onClick={() => setBarcodeProduct(null)}
                variant="secondary"
                className="flex-1"
              >
                Scan Again
              </Button>
              <Button
                onClick={handleAddBarcodeProduct}
                isLoading={isAdding}
                className="flex-1"
              >
                Add Food
              </Button>
            </div>
          </div>
        ) : (
          /* Show barcode scanner */
          <BarcodeScanner
            onProductFound={handleBarcodeProduct}
            onClose={onClose}
          />
        )
      ) : (
        /* Manual Entry */
        <div className="space-y-3">
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="Food name"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder-surface-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-surface-500 mb-1">Calories</label>
              <input
                type="number"
                value={manualCalories}
                onChange={(e) => setManualCalories(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Protein (g)</label>
              <input
                type="number"
                value={manualProtein}
                onChange={(e) => setManualProtein(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Carbs (g)</label>
              <input
                type="number"
                value={manualCarbs}
                onChange={(e) => setManualCarbs(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Fat (g)</label>
              <input
                type="number"
                value={manualFat}
                onChange={(e) => setManualFat(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100"
              />
            </div>
          </div>
          <Button
            onClick={handleManualAdd}
            isLoading={isAdding}
            disabled={!manualName.trim() || !manualCalories}
            className="w-full"
          >
            Add Food
          </Button>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="w-full py-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

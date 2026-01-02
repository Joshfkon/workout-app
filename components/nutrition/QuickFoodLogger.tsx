'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui';
import { BarcodeScanner } from './BarcodeScanner';
import type { BarcodeSearchResult } from '@/services/openFoodFactsService';
import type { FrequentFood, SystemFood, MealType } from '@/types/nutrition';

// Parse weight from serving_size string like "1 portion (85.048 g)" or "100g"
function parseServingWeight(servingSize: string | null | undefined): number | null {
  if (!servingSize) return null;
  
  // Try to match patterns like "(85.048 g)", "(100g)", "100 g", "3 oz"
  const gramMatch = servingSize.match(/\(?([\d.]+)\s*g(?:rams?)?\)?/i);
  if (gramMatch) {
    return parseFloat(gramMatch[1]);
  }
  
  const ozMatch = servingSize.match(/\(?([\d.]+)\s*oz(?:ounces?)?\)?/i);
  if (ozMatch) {
    return parseFloat(ozMatch[1]) * 28.3495;
  }
  
  return null;
}

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
  const [selectedFrequentFood, setSelectedFrequentFood] = useState<FrequentFood | null>(null);
  const [weightAmount, setWeightAmount] = useState('100');
  const [weightUnit, setWeightUnit] = useState<'g' | 'oz'>('g');
  const [frequentServings, setFrequentServings] = useState('1');
  const [frequentInputMode, setFrequentInputMode] = useState<'servings' | 'weight'>('servings');
  const [frequentWeightAmount, setFrequentWeightAmount] = useState('');
  const [frequentWeightUnit, setFrequentWeightUnit] = useState<'g' | 'oz'>('g');

  // Manual entry state
  const [manualName, setManualName] = useState('');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  // Barcode product state
  const [barcodeProduct, setBarcodeProduct] = useState<NonNullable<BarcodeSearchResult['product']> | null>(null);
  const [barcodeQuantity, setBarcodeQuantity] = useState('1');
  const [barcodeUnit, setBarcodeUnit] = useState<'serving' | 'grams'>('serving');

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
    const qNoSpaces = q.replace(/\s+/g, '');
    return systemFoods.filter(f => {
      const name = f.name.toLowerCase();
      // Match either with spaces or without (e.g., "Rx bar" matches "RXBAR")
      return name.includes(q) || name.replace(/\s+/g, '').includes(qNoSpaces);
    }).slice(0, 20);
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

  // Get weight per serving for selected frequent food
  const frequentFoodWeightPerServing = useMemo(() => {
    return parseServingWeight(selectedFrequentFood?.serving_size);
  }, [selectedFrequentFood?.serving_size]);

  // Calculate effective servings based on input mode
  const effectiveFrequentServings = useMemo(() => {
    if (frequentInputMode === 'servings') {
      return parseFloat(frequentServings) || 0;
    } else if (frequentFoodWeightPerServing) {
      const weightInGrams = frequentWeightUnit === 'oz' 
        ? (parseFloat(frequentWeightAmount) || 0) * 28.3495 
        : (parseFloat(frequentWeightAmount) || 0);
      return weightInGrams / frequentFoodWeightPerServing;
    }
    return 0;
  }, [frequentInputMode, frequentServings, frequentWeightAmount, frequentWeightUnit, frequentFoodWeightPerServing]);

  // Calculate nutrition for selected frequent food
  const frequentFoodNutrition = useMemo(() => {
    if (!selectedFrequentFood) return null;
    return {
      calories: Math.round(selectedFrequentFood.avg_calories * effectiveFrequentServings),
      protein: Math.round(selectedFrequentFood.avg_protein * effectiveFrequentServings * 10) / 10,
      carbs: Math.round(selectedFrequentFood.avg_carbs * effectiveFrequentServings * 10) / 10,
      fat: Math.round(selectedFrequentFood.avg_fat * effectiveFrequentServings * 10) / 10,
    };
  }, [selectedFrequentFood, effectiveFrequentServings]);

  // Calculate nutrition for barcode product based on quantity/unit selection
  const barcodeProductNutrition = useMemo(() => {
    if (!barcodeProduct) return null;

    const qty = parseFloat(barcodeQuantity) || 0;
    let multiplier = 0;

    if (barcodeUnit === 'serving') {
      // qty servings
      multiplier = qty;
    } else {
      // qty grams - convert to servings using servingQuantity (grams per serving)
      multiplier = qty / barcodeProduct.servingQuantity;
    }

    return {
      calories: Math.round(barcodeProduct.calories * multiplier),
      protein: Math.round(barcodeProduct.protein * multiplier * 10) / 10,
      carbs: Math.round(barcodeProduct.carbs * multiplier * 10) / 10,
      fat: Math.round(barcodeProduct.fat * multiplier * 10) / 10,
      multiplier,
    };
  }, [barcodeProduct, barcodeQuantity, barcodeUnit]);

  // Get display text for barcode serving size
  const getBarcodeServingSizeDisplay = () => {
    if (!barcodeProduct) return '';
    const qty = parseFloat(barcodeQuantity) || 0;

    if (barcodeUnit === 'serving') {
      return `${qty} ${qty === 1 ? 'serving' : 'servings'} (${Math.round(barcodeProduct.servingQuantity * qty)}g)`;
    } else {
      return `${qty}g`;
    }
  };

  const handleSelectFrequentFood = (food: FrequentFood) => {
    setSelectedFrequentFood(food);
    setFrequentServings('1');
    setFrequentInputMode('servings');
    // Initialize weight based on serving size
    const weightPerServing = parseServingWeight(food.serving_size);
    if (weightPerServing) {
      setFrequentWeightAmount(Math.round(weightPerServing).toString());
    }
  };

  const handleAddSelectedFrequentFood = async () => {
    if (!selectedFrequentFood || !frequentFoodNutrition || effectiveFrequentServings <= 0) return;
    setIsAdding(true);
    try {
      await onAdd({
        food_name: selectedFrequentFood.food_name,
        serving_size: selectedFrequentFood.serving_size || '1 serving',
        servings: effectiveFrequentServings,
        calories: frequentFoodNutrition.calories,
        protein: frequentFoodNutrition.protein,
        carbs: frequentFoodNutrition.carbs,
        fat: frequentFoodNutrition.fat,
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
      // Reset portion selection for new product
      setBarcodeQuantity('1');
      setBarcodeUnit('serving');
    } catch (err) {
      console.error('[QuickFoodLogger] Error setting product:', err);
    }
  };

  const handleAddBarcodeProduct = async () => {
    if (!barcodeProduct || !barcodeProductNutrition) return;
    setIsAdding(true);
    try {
      await onAdd({
        food_name: barcodeProduct.name,
        serving_size: getBarcodeServingSizeDisplay(),
        servings: 1, // We've already calculated the total
        calories: barcodeProductNutrition.calories,
        protein: barcodeProductNutrition.protein,
        carbs: barcodeProductNutrition.carbs,
        fat: barcodeProductNutrition.fat,
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
              setSelectedFrequentFood(null);
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
          onClick={() => { setMode('foods'); setBarcodeProduct(null); setSelectedFood(null); setSelectedFrequentFood(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'foods'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          ⚡ Quick Add
        </button>
        <button
          onClick={() => { setMode('barcode'); setBarcodeProduct(null); setSelectedFood(null); setSelectedFrequentFood(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'barcode'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          📷 Scan
        </button>
        <button
          onClick={() => { setMode('manual'); setBarcodeProduct(null); setSelectedFood(null); setSelectedFrequentFood(null); }}
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
            onChange={(e) => { setQuery(e.target.value); setSelectedFood(null); setSelectedFrequentFood(null); }}
            placeholder="Search foods..."
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder-surface-500"
          />

          {selectedFrequentFood ? (
            /* Selected Frequent Food - Servings/Weight Entry */
            <div className="space-y-3 p-3 bg-surface-900 rounded-lg">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-surface-100">{selectedFrequentFood.food_name}</p>
                  <p className="text-xs text-surface-400">
                    {selectedFrequentFood.serving_size || '1 serving'} · {Math.round(selectedFrequentFood.avg_calories)} cal
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFrequentFood(null)}
                  className="text-surface-400 hover:text-surface-200 text-lg"
                >
                  ×
                </button>
              </div>

              {frequentInputMode === 'servings' ? (
                <>
                  {/* Quick serving buttons */}
                  <div className="grid grid-cols-6 gap-1">
                    {[0.5, 0.75, 1, 1.5, 2, 3].map((s) => (
                      <button
                        key={s}
                        onClick={() => setFrequentServings(s.toString())}
                        className={`py-2 rounded text-xs font-medium transition-all ${
                          parseFloat(frequentServings) === s
                            ? 'bg-primary-500 text-white'
                            : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                        }`}
                      >
                        {s === 0.5 ? '½' : s === 0.75 ? '¾' : `${s}×`}
                      </button>
                    ))}
                  </div>

                  {/* Custom servings input */}
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={frequentServings}
                      onChange={(e) => setFrequentServings(e.target.value)}
                      className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 text-center"
                    />
                    {/* Tappable unit label */}
                    <button
                      onClick={() => {
                        if (frequentFoodWeightPerServing) {
                          setFrequentInputMode('weight');
                          // Convert current servings to weight
                          const currentServings = parseFloat(frequentServings) || 1;
                          setFrequentWeightAmount(Math.round(currentServings * frequentFoodWeightPerServing).toString());
                        }
                      }}
                      className={`text-sm px-2 py-1 rounded transition-colors ${
                        frequentFoodWeightPerServing 
                          ? 'text-primary-400 hover:bg-primary-500/20 cursor-pointer' 
                          : 'text-surface-400 cursor-default'
                      }`}
                      disabled={!frequentFoodWeightPerServing}
                      title={frequentFoodWeightPerServing ? 'Tap to switch to grams' : 'Weight info not available'}
                    >
                      servings {frequentFoodWeightPerServing && '↔'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Quick weight buttons */}
                  <div className="flex flex-wrap gap-1">
                    {(frequentWeightUnit === 'g' ? [50, 100, 150, 200, 250, 300] : [1, 2, 3, 4, 6, 8]).map((w) => (
                      <button
                        key={w}
                        onClick={() => setFrequentWeightAmount(w.toString())}
                        className={`py-2 px-3 rounded text-xs font-medium transition-all ${
                          parseFloat(frequentWeightAmount) === w
                            ? 'bg-primary-500 text-white'
                            : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                        }`}
                      >
                        {w}{frequentWeightUnit}
                      </button>
                    ))}
                  </div>

                  {/* Weight input with tappable unit */}
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={frequentWeightAmount}
                      onChange={(e) => setFrequentWeightAmount(e.target.value)}
                      className="min-w-0 flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 text-center"
                    />
                    {/* Tappable unit toggle */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          if (frequentWeightUnit === 'oz') {
                            // Convert oz to g
                            const ozValue = parseFloat(frequentWeightAmount) || 0;
                            setFrequentWeightAmount(Math.round(ozValue * 28.3495).toString());
                          }
                          setFrequentWeightUnit('g');
                        }}
                        className={`text-xs px-2 py-1.5 rounded transition-colors ${
                          frequentWeightUnit === 'g'
                            ? 'bg-primary-500 text-white'
                            : 'text-surface-400 hover:bg-surface-700'
                        }`}
                      >
                        g
                      </button>
                      <button
                        onClick={() => {
                          if (frequentWeightUnit === 'g') {
                            // Convert g to oz
                            const gValue = parseFloat(frequentWeightAmount) || 0;
                            setFrequentWeightAmount((gValue / 28.3495).toFixed(1));
                          }
                          setFrequentWeightUnit('oz');
                        }}
                        className={`text-xs px-2 py-1.5 rounded transition-colors ${
                          frequentWeightUnit === 'oz'
                            ? 'bg-primary-500 text-white'
                            : 'text-surface-400 hover:bg-surface-700'
                        }`}
                      >
                        oz
                      </button>
                      <button
                        onClick={() => {
                          setFrequentInputMode('servings');
                          // Convert weight back to servings
                          if (frequentFoodWeightPerServing) {
                            const weightInGrams = frequentWeightUnit === 'oz'
                              ? (parseFloat(frequentWeightAmount) || 0) * 28.3495
                              : (parseFloat(frequentWeightAmount) || 0);
                            setFrequentServings((weightInGrams / frequentFoodWeightPerServing).toFixed(2));
                          }
                        }}
                        className="text-xs text-primary-400 hover:bg-primary-500/20 px-2 py-1.5 rounded"
                        title="Switch to servings"
                      >
                        srv
                      </button>
                    </div>
                  </div>

                  {/* Show equivalent servings */}
                  {effectiveFrequentServings > 0 && (
                    <p className="text-xs text-surface-500 text-center">
                      ≈ {effectiveFrequentServings.toFixed(2)} servings
                    </p>
                  )}
                </>
              )}

              {frequentFoodNutrition && (
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-surface-100">{frequentFoodNutrition.calories}</p>
                    <p className="text-surface-500">cal</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-red-400">{frequentFoodNutrition.protein}g</p>
                    <p className="text-surface-500">protein</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-yellow-400">{frequentFoodNutrition.carbs}g</p>
                    <p className="text-surface-500">carbs</p>
                  </div>
                  <div className="p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-blue-400">{frequentFoodNutrition.fat}g</p>
                    <p className="text-surface-500">fat</p>
                  </div>
                </div>
              )}

              <Button
                onClick={handleAddSelectedFrequentFood}
                isLoading={isAdding}
                className="w-full"
              >
                Add to {mealType}
              </Button>
            </div>
          ) : selectedFood ? (
            /* Selected System Food - Weight Entry */
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
                        onClick={() => handleSelectFrequentFood(food)}
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
          /* Show scanned product with portion selector */
          <div className="space-y-3">
            <div className="p-4 bg-surface-900 rounded-lg space-y-4">
              {/* Product Info */}
              <div className="flex items-start gap-3">
                {barcodeProduct.imageUrl ? (
                  <div className="flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={barcodeProduct.imageUrl}
                      alt={barcodeProduct.name}
                      className="h-16 w-16 object-contain rounded-lg bg-white"
                    />
                  </div>
                ) : (
                  <div className="h-16 w-16 bg-surface-700 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">🍽️</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-surface-100 leading-tight">{barcodeProduct.name}</h3>
                  <p className="text-xs text-surface-500 mt-1">
                    Base: {barcodeProduct.servingSize}
                  </p>
                </div>
              </div>

              {/* Portion Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-surface-400 uppercase tracking-wide">
                  Amount
                </label>

                {/* Quick portion buttons */}
                <div className="grid grid-cols-6 gap-1">
                  {[0.5, 0.75, 1, 1.5, 2, 3].map((qty) => (
                    <button
                      key={qty}
                      onClick={() => {
                        setBarcodeQuantity(qty.toString());
                        setBarcodeUnit('serving');
                      }}
                      className={`py-2 rounded text-xs font-medium transition-all ${
                        parseFloat(barcodeQuantity) === qty && barcodeUnit === 'serving'
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                      }`}
                    >
                      {qty === 0.5 ? '½' : qty === 0.75 ? '¾' : `${qty}×`}
                    </button>
                  ))}
                </div>

                {/* Custom input with unit toggle */}
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step={barcodeUnit === 'serving' ? '0.1' : '1'}
                    min="0.1"
                    value={barcodeQuantity}
                    onChange={(e) => setBarcodeQuantity(e.target.value)}
                    className="min-w-0 flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 text-center"
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        if (barcodeUnit === 'grams') {
                          // Convert grams back to servings
                          const grams = parseFloat(barcodeQuantity) || 0;
                          const servings = grams / barcodeProduct.servingQuantity;
                          setBarcodeQuantity(servings.toFixed(2));
                        }
                        setBarcodeUnit('serving');
                      }}
                      className={`text-xs px-2 py-1.5 rounded transition-colors ${
                        barcodeUnit === 'serving'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:bg-surface-700'
                      }`}
                    >
                      serving
                    </button>
                    <button
                      onClick={() => {
                        if (barcodeUnit === 'serving') {
                          // Convert servings to grams
                          const servings = parseFloat(barcodeQuantity) || 0;
                          const grams = Math.round(servings * barcodeProduct.servingQuantity);
                          setBarcodeQuantity(grams.toString());
                        }
                        setBarcodeUnit('grams');
                      }}
                      className={`text-xs px-2 py-1.5 rounded transition-colors ${
                        barcodeUnit === 'grams'
                          ? 'bg-primary-500 text-white'
                          : 'text-surface-400 hover:bg-surface-700'
                      }`}
                    >
                      grams
                    </button>
                  </div>
                </div>

                {/* Show serving equivalent when in grams mode */}
                {barcodeUnit === 'grams' && barcodeProductNutrition && (
                  <p className="text-xs text-surface-500 text-center">
                    ≈ {barcodeProductNutrition.multiplier.toFixed(2)} servings
                  </p>
                )}
              </div>

              {/* Live Nutrition Display */}
              {barcodeProductNutrition && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-primary-400">{barcodeProductNutrition.calories}</p>
                    <p className="text-xs text-surface-500">cal</p>
                  </div>
                  <div className="text-center p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-red-400">{barcodeProductNutrition.protein}g</p>
                    <p className="text-xs text-surface-500">protein</p>
                  </div>
                  <div className="text-center p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-yellow-400">{barcodeProductNutrition.carbs}g</p>
                    <p className="text-xs text-surface-500">carbs</p>
                  </div>
                  <div className="text-center p-2 bg-surface-800 rounded">
                    <p className="text-lg font-bold text-blue-400">{barcodeProductNutrition.fat}g</p>
                    <p className="text-xs text-surface-500">fat</p>
                  </div>
                </div>
              )}
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
                disabled={!barcodeProductNutrition?.calories}
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

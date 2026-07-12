'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { FoodSearchResult, FoodSearchResultWithServings } from '@/services/usdaService';
import { searchFoodsAction, getFoodDetailsAction } from '@/lib/actions/food-search';
import { lookupBarcode as lookupBarcodeOFF } from '@/services/openFoodFactsService';
import dynamic from 'next/dynamic';
import { ServingAmountEditor, type ServingAmountValue } from './ServingAmountEditor';
import {
  computeServing,
  weightBasedModel,
  packagedModel,
  perServingModel,
  customPerRefModel,
  servingOptionsModel,
  parseServingWeight,
  type FoodAmountModel,
} from '@/lib/nutrition/servingScaling';
import {
  foodKeyFor,
  getLastUsedServing,
  getRecentAmounts,
  recordLastUsedServing,
} from '@/lib/nutrition/lastUsedServing';

// P1-2 (perf): html5-qrcode is ~90KB gz and only needed when the Barcode tab
// is actually opened — load it on demand instead of in nutrition's first-load.
const BarcodeScanner = dynamic(
  () => import('./BarcodeScanner').then((m) => m.BarcodeScanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-10 text-sm text-surface-400">
        Loading camera…
      </div>
    ),
  }
);
import { IconSearch, IconScan, IconPencil, IconX, IconToolsKitchen2 } from '@tabler/icons-react';
import type { MealType, CustomFood, FrequentFood, SystemFood } from '@/types/nutrition';

interface ScannedProduct {
  name: string;
  brand?: string;
  servingSize: string;
  servingQuantity: number; // grams per serving
  calories: number; // per serving
  protein: number;
  carbs: number;
  fat: number;
  imageUrl?: string;
  barcode: string;
}

export type AddFoodTab = 'search' | 'barcode' | 'manual';

interface AddFoodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (food: {
    food_name: string;
    serving_size: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_type: MealType;
    source?: 'usda' | 'fatsecret' | 'nutritionix' | 'custom' | 'manual';
    food_id?: string;
    nutritionix_id?: string;
    barcode?: string;
  }) => Promise<void>;
  defaultMealType: MealType;
  /** Tab to open on (Scan quick action opens 'barcode') */
  initialTab?: AddFoodTab;
  /** Called when a scanned barcode isn't found and the user wants to create a custom food */
  onCreateCustomFood?: (barcode: string) => void;
  customFoods?: CustomFood[];
  frequentFoods?: FrequentFood[];
  systemFoods?: SystemFood[];
}

const CATEGORY_LABELS: Record<string, string> = {
  protein: 'Proteins',
  carbs: 'Carbs',
  fats: 'Fats',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  supplements: 'Supplements',
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium text-surface-500 uppercase tracking-wide mb-1.5">
      {children}
    </p>
  );
}

/** Tidy a USDA serving description into a unit noun (strip trailing "(…g)" and a
 * leading "1 " so "1 cup (160g)" → "cup" while "2 tbsp" is left intact). */
function cleanServingNoun(desc: string): string {
  const noParen = desc.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const noLeadingOne = noParen.replace(/^1\s+/, '').trim();
  return noLeadingOne || noParen || desc;
}

/** Normalise a selectable food (USDA / custom / system) into a scaling model. */
function buildUsdaModel(food: FoodSearchResult | FoodSearchResultWithServings): FoodAmountModel {
  const withServings = food as FoodSearchResultWithServings;
  if (Array.isArray(withServings.servings) && withServings.servings.length > 0) {
    return servingOptionsModel(
      withServings.servings.map((s) => ({
        noun: cleanServingNoun(s.description),
        grams: parseServingWeight(s.description).grams,
        macros: { calories: s.calories, protein: s.protein, carbs: s.carbs, fat: s.fat },
      }))
    );
  }
  return perServingModel(
    { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat },
    'serving',
    parseServingWeight(food.servingSize).grams
  );
}

function buildCustomModel(food: CustomFood): FoodAmountModel {
  if (food.is_per_weight && food.reference_amount && food.calories_per_ref != null) {
    return customPerRefModel(
      {
        calories: food.calories_per_ref || 0,
        protein: food.protein_per_ref || 0,
        carbs: food.carbs_per_ref || 0,
        fat: food.fat_per_ref || 0,
      },
      food.reference_amount,
      food.reference_unit || 'g'
    );
  }
  const grams = parseServingWeight(food.serving_size).grams;
  return perServingModel(
    {
      calories: food.calories || 0,
      protein: food.protein || 0,
      carbs: food.carbs || 0,
      fat: food.fat || 0,
    },
    food.serving_size ? cleanServingNoun(food.serving_size) : 'serving',
    grams
  );
}

export function AddFoodModal({
  isOpen,
  onClose,
  onAdd,
  defaultMealType,
  initialTab,
  onCreateCustomFood,
  customFoods = [],
  frequentFoods = [],
  systemFoods = [],
}: AddFoodModalProps) {
  const [activeTab, setActiveTab] = useState<AddFoodTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState<FoodSearchResult[]>([]);
  const [isSearchingUsda, setIsSearchingUsda] = useState(false);
  const [usdaError, setUsdaError] = useState('');
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | FoodSearchResultWithServings | null>(null);
  const [selectedCustomFood, setSelectedCustomFood] = useState<CustomFood | null>(null);
  const [selectedSystemFood, setSelectedSystemFood] = useState<SystemFood | null>(null);

  // Unified AMOUNT + UNIT state, shared by every food source and the barcode
  // result. The model below tells the editor which units/chips to offer.
  const [amountValue, setAmountValue] = useState<ServingAmountValue>({ amount: '100', unitId: 'g' });
  const [recentAmounts, setRecentAmounts] = useState<number[]>([]);
  const [mealType, setMealType] = useState<MealType>(defaultMealType);

  // Manual entry
  const [manualFood, setManualFood] = useState({
    food_name: '',
    amount: '1',
    unit: 'serving',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [barcodeError, setBarcodeError] = useState('');
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Scanned product state
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(null);

  // Reset meal type + tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setMealType(defaultMealType);
      setActiveTab(initialTab ?? 'search');
    }
  }, [isOpen, defaultMealType, initialTab]);

  // Debounce the unified search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // USDA search: only when the debounced query is at least 3 characters
  useEffect(() => {
    if (activeTab !== 'search' || debouncedQuery.length < 3) {
      setUsdaResults([]);
      setUsdaError('');
      setIsSearchingUsda(false);
      return;
    }
    let cancelled = false;
    setIsSearchingUsda(true);
    setUsdaError('');
    searchFoodsAction(debouncedQuery)
      .then((result) => {
        if (cancelled) return;
        if (result.error && result.foods.length === 0) {
          setUsdaError(result.error);
          setUsdaResults([]);
        } else {
          setUsdaResults(result.foods);
        }
      })
      .catch(() => {
        if (!cancelled) setUsdaError('Search failed. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsSearchingUsda(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, activeTab]);

  const matchesQuery = useMemo(() => {
    const query = debouncedQuery.toLowerCase();
    const queryNoSpaces = query.replace(/\s+/g, '');
    return (name: string) => {
      if (!query) return true;
      const lower = name.toLowerCase();
      // Match either with spaces or without (e.g., "Rx bar" matches "RXBAR")
      return lower.includes(query) || lower.replace(/\s+/g, '').includes(queryNoSpaces);
    };
  }, [debouncedQuery]);

  // "Your foods": frequent foods for this meal + custom foods
  const frequentFoodsForMeal = useMemo(() => {
    return frequentFoods
      .filter((f) => f.meal_type === mealType && matchesQuery(f.food_name))
      .sort((a, b) => b.times_logged - a.times_logged)
      .slice(0, 5);
  }, [frequentFoods, mealType, matchesQuery]);

  const filteredCustomFoods = useMemo(() => {
    const filtered = customFoods.filter((f) => matchesQuery(f.food_name));
    return debouncedQuery ? filtered.slice(0, 20) : filtered.slice(0, 8);
  }, [customFoods, matchesQuery, debouncedQuery]);

  // "Common foods": system foods
  const filteredSystemFoods = useMemo(() => {
    const filtered = systemFoods.filter((f) => matchesQuery(f.name));
    return debouncedQuery ? filtered.slice(0, 20) : filtered;
  }, [systemFoods, matchesQuery, debouncedQuery]);

  const groupedSystemFoods = useMemo(() => {
    const groups: Record<string, SystemFood[]> = {};
    for (const food of filteredSystemFoods) {
      if (!groups[food.category]) {
        groups[food.category] = [];
      }
      groups[food.category].push(food);
    }
    return groups;
  }, [filteredSystemFoods]);

  // The currently active selection (search selection or scanned product),
  // normalised so a single detail panel + add handler serves every source.
  const activeSelection = useMemo(() => {
    if (scannedProduct) {
      return {
        model: packagedModel(
          {
            calories: scannedProduct.calories,
            protein: scannedProduct.protein,
            carbs: scannedProduct.carbs,
            fat: scannedProduct.fat,
          },
          scannedProduct.servingQuantity,
          'serving'
        ),
        foodKey: foodKeyFor({ barcode: scannedProduct.barcode, name: scannedProduct.name }),
        name: scannedProduct.name,
        subtitle: `Base: ${scannedProduct.servingSize}`,
        source: 'nutritionix' as const,
        barcode: scannedProduct.barcode,
      };
    }
    if (selectedFood) {
      return {
        model: buildUsdaModel(selectedFood),
        foodKey: foodKeyFor({ foodId: selectedFood.foodId, name: selectedFood.name }),
        name: selectedFood.name,
        subtitle: selectedFood.servingSize,
        source: 'usda' as const,
        food_id: selectedFood.foodId,
      };
    }
    if (selectedCustomFood) {
      return {
        model: buildCustomModel(selectedCustomFood),
        foodKey: foodKeyFor({ id: selectedCustomFood.id, name: selectedCustomFood.food_name }),
        name: selectedCustomFood.food_name,
        subtitle: selectedCustomFood.is_per_weight
          ? `Per ${selectedCustomFood.reference_amount}${selectedCustomFood.reference_unit || 'g'}`
          : selectedCustomFood.serving_size || '1 serving',
        source: 'custom' as const,
      };
    }
    if (selectedSystemFood) {
      return {
        model: weightBasedModel({
          calories: selectedSystemFood.calories_per_100g,
          protein: selectedSystemFood.protein_per_100g,
          carbs: selectedSystemFood.carbs_per_100g,
          fat: selectedSystemFood.fat_per_100g,
        }),
        foodKey: foodKeyFor({ id: selectedSystemFood.id, name: selectedSystemFood.name }),
        name: selectedSystemFood.name,
        subtitle: `${selectedSystemFood.calories_per_100g} cal per 100g`,
        source: 'manual' as const,
      };
    }
    return null;
  }, [scannedProduct, selectedFood, selectedCustomFood, selectedSystemFood]);

  // Prefill the amount/unit from the last-used value for a food (falls back to
  // the model's default serving), and load the recent-amount quick-chips.
  const primeAmountForFood = (model: FoodAmountModel, foodKey: string) => {
    const lastUsed = getLastUsedServing(foodKey);
    const unitExists = lastUsed && model.units.some((u) => u.id === lastUsed.unitId);
    const unitId = unitExists ? lastUsed!.unitId : model.defaultUnitId;
    const amount = unitExists ? lastUsed!.amount : model.defaultAmount;
    setAmountValue({ amount: amount.toString(), unitId });
    setRecentAmounts(getRecentAmounts(foodKey, unitId, 2));
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setBarcodeError('');
    setNotFoundBarcode(null);
    setIsLookingUpBarcode(true);

    try {
      const result = await lookupBarcodeOFF(barcode);
      if (!result.found || !result.product) {
        setBarcodeError(result.error || 'Product not found.');
        setNotFoundBarcode(barcode);
      } else {
        const product: ScannedProduct = {
          name: result.product.name,
          brand: result.product.brand,
          servingSize: result.product.servingSize,
          servingQuantity: result.product.servingQuantity,
          calories: result.product.calories,
          protein: result.product.protein,
          carbs: result.product.carbs,
          fat: result.product.fat,
          imageUrl: result.product.imageUrl,
          barcode: result.product.barcode,
        };
        setScannedProduct(product);
        const model = packagedModel(
          { calories: product.calories, protein: product.protein, carbs: product.carbs, fat: product.fat },
          product.servingQuantity,
          'serving'
        );
        primeAmountForFood(model, foodKeyFor({ barcode: product.barcode, name: product.name }));
        // Stay on barcode tab to show serving selector
      }
    } catch {
      setBarcodeError('Failed to lookup barcode. Please try again.');
    } finally {
      setIsLookingUpBarcode(false);
    }
  };

  const handleSelectFood = async (food: FoodSearchResult) => {
    setSelectedFood(food);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    primeAmountForFood(buildUsdaModel(food), foodKeyFor({ foodId: food.foodId, name: food.name }));

    // If the food has a foodId, fetch detailed info with serving options
    const hasServings = 'servings' in food && Array.isArray((food as FoodSearchResultWithServings).servings);
    if (food.foodId && !hasServings) {
      setIsLoadingDetails(true);
      try {
        const result = await getFoodDetailsAction(food.foodId);
        if (result.food) {
          setSelectedFood(result.food);
          primeAmountForFood(buildUsdaModel(result.food), foodKeyFor({ foodId: result.food.foodId, name: result.food.name }));
        }
      } catch (err) {
        console.error('Error fetching food details:', err);
      } finally {
        setIsLoadingDetails(false);
      }
    }
  };

  const handleSelectCustomFood = (food: CustomFood) => {
    setSelectedCustomFood(food);
    setSelectedFood(null);
    setSelectedSystemFood(null);
    primeAmountForFood(buildCustomModel(food), foodKeyFor({ id: food.id, name: food.food_name }));
  };

  const handleSelectSystemFood = (food: SystemFood) => {
    setSelectedSystemFood(food);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    const model = weightBasedModel({
      calories: food.calories_per_100g,
      protein: food.protein_per_100g,
      carbs: food.carbs_per_100g,
      fat: food.fat_per_100g,
    });
    primeAmountForFood(model, foodKeyFor({ id: food.id, name: food.name }));
  };

  // Single add handler for every selectable / scanned food.
  const handleAddSelection = async () => {
    if (!activeSelection) return;

    const amountNum = parseFloat(amountValue.amount);
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = computeServing(activeSelection.model, amountValue.amount, amountValue.unitId);
      await onAdd({
        food_name: activeSelection.name,
        serving_size: result.servingSize,
        servings: result.servings,
        calories: result.macros.calories,
        protein: result.macros.protein,
        carbs: result.macros.carbs,
        fat: result.macros.fat,
        meal_type: mealType,
        source: activeSelection.source,
        food_id: activeSelection.food_id,
        barcode: activeSelection.barcode,
      });
      recordLastUsedServing(activeSelection.foodKey, amountNum, amountValue.unitId);
      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddManualFood = async () => {
    if (!manualFood.food_name || !manualFood.calories) {
      setError('Please enter at least food name and calories');
      return;
    }

    const calories = parseFloat(manualFood.calories);
    if (!calories || calories < 0) {
      setError('Please enter a valid calorie amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const amountNum = parseFloat(manualFood.amount) || 1;
      const unit = manualFood.unit.trim() || 'serving';
      await onAdd({
        food_name: manualFood.food_name,
        serving_size: `${amountNum} ${unit}`,
        servings: 1,
        calories: Math.round(calories),
        protein: parseFloat(manualFood.protein) || 0,
        carbs: parseFloat(manualFood.carbs) || 0,
        fat: parseFloat(manualFood.fat) || 0,
        meal_type: mealType,
        source: 'manual',
      });

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddFrequentFood = async (food: FrequentFood) => {
    setIsSubmitting(true);
    setError('');

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

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearSelection = () => {
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
  };

  const resetAndClose = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setUsdaResults([]);
    setUsdaError('');
    clearSelection();
    setAmountValue({ amount: '100', unitId: 'g' });
    setRecentAmounts([]);
    setManualFood({
      food_name: '',
      amount: '1',
      unit: 'serving',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
    });
    setError('');
    setBarcodeError('');
    setNotFoundBarcode(null);
    setScannedProduct(null);
    onClose();
  };

  // Handle scan again
  const handleScanAgain = () => {
    setScannedProduct(null);
    setBarcodeError('');
    setNotFoundBarcode(null);
  };

  const hasSelection = !!(selectedFood || selectedCustomFood || selectedSystemFood);
  const showUsdaSection = debouncedQuery.length >= 3;

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add food"
      size="lg"
    >
      <div className="space-y-4">
        {/* Meal Type Selector */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1">
            Meal
          </label>
          <Select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            options={[
              { value: 'breakfast', label: 'Breakfast' },
              { value: 'lunch', label: 'Lunch' },
              { value: 'dinner', label: 'Dinner' },
              { value: 'snack', label: 'Snack' },
            ]}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-surface-800 overflow-x-auto">
          {([
            { id: 'search' as AddFoodTab, label: 'Search', icon: IconSearch },
            { id: 'barcode' as AddFoodTab, label: 'Barcode', icon: IconScan },
            { id: 'manual' as AddFoodTab, label: 'Manual', icon: IconPencil },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                clearSelection();
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <tab.icon size={15} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Unified Search Tab: your foods + common foods + USDA */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            {!hasSelection && (
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your foods, common foods, and USDA..."
                className="w-full"
              />
            )}

            {/* Selected food detail — one panel, one editor, every source */}
            {hasSelection && activeSelection && (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg" data-testid="add-food-detail">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium text-surface-100">{activeSelection.name}</h3>
                    <p className="text-xs text-primary-400">{activeSelection.subtitle}</p>
                  </div>
                  <button
                    onClick={clearSelection}
                    className="text-surface-400 hover:text-surface-200 flex-shrink-0"
                    aria-label="Clear selection"
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>

                {isLoadingDetails ? (
                  <p className="text-sm text-surface-400 py-2">Loading serving options...</p>
                ) : (
                  <>
                    <ServingAmountEditor
                      model={activeSelection.model}
                      value={amountValue}
                      onChange={setAmountValue}
                      recentAmounts={recentAmounts}
                      testIdPrefix="add-food"
                    />

                    <Button
                      onClick={handleAddSelection}
                      variant="primary"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Adding...' : 'Add to log'}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Search result sections */}
            {!hasSelection && (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {/* Your foods: frequent for this meal + custom foods */}
                <section>
                  <SectionLabel>Your foods</SectionLabel>
                  {frequentFoodsForMeal.length === 0 && filteredCustomFoods.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">
                      {debouncedQuery ? 'No matches in your foods' : `No ${MEAL_LABELS[mealType].toLowerCase()} favorites or custom foods yet`}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {frequentFoodsForMeal.map((food, idx) => (
                        <button
                          key={`freq-${idx}`}
                          onClick={() => handleAddFrequentFood(food)}
                          disabled={isSubmitting}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-medium text-surface-200">{food.food_name}</p>
                            <p className="text-xs text-surface-500">
                              {Math.round(food.avg_calories)} cal · logged {food.times_logged}x
                            </p>
                          </div>
                          <span className="text-primary-400 text-sm flex-shrink-0">+ Add</span>
                        </button>
                      ))}
                      {filteredCustomFoods.map((food) => (
                        <button
                          key={food.id}
                          onClick={() => handleSelectCustomFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                        >
                          <div>
                            <p className="text-sm font-medium text-surface-200">{food.food_name}</p>
                            <p className="text-xs text-surface-500">
                              {food.is_per_weight
                                ? `${food.calories_per_ref} cal per ${food.reference_amount}${food.reference_unit || 'g'}`
                                : `${food.calories} cal · ${food.serving_size}`}
                            </p>
                          </div>
                          <span className="text-xs text-surface-500 flex-shrink-0">Custom</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {/* Common foods: system foods */}
                <section>
                  <SectionLabel>Common foods</SectionLabel>
                  {filteredSystemFoods.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">No matches in common foods</p>
                  ) : debouncedQuery ? (
                    <div className="space-y-1">
                      {filteredSystemFoods.map((food) => (
                        <button
                          key={food.id}
                          onClick={() => handleSelectSystemFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                        >
                          <span className="text-sm text-surface-200">{food.name}</span>
                          <span className="text-xs text-surface-500 flex-shrink-0">
                            {food.calories_per_100g} cal | {food.protein_per_100g}g P
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    Object.entries(groupedSystemFoods).map(([category, foods]) => (
                      <div key={category} className="mb-2">
                        <p className="text-[11px] text-surface-600 mb-1">
                          {CATEGORY_LABELS[category] || category}
                        </p>
                        <div className="space-y-1">
                          {foods.slice(0, 6).map((food) => (
                            <button
                              key={food.id}
                              onClick={() => handleSelectSystemFood(food)}
                              className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center"
                            >
                              <span className="text-sm text-surface-200">{food.name}</span>
                              <span className="text-xs text-surface-500 flex-shrink-0">
                                {food.calories_per_100g} cal | {food.protein_per_100g}g P
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </section>

                {/* USDA database */}
                <section>
                  <SectionLabel>USDA database</SectionLabel>
                  {!showUsdaSection ? (
                    <p className="text-[13px] text-surface-500 py-1">
                      Type at least 3 characters to search the USDA database
                    </p>
                  ) : isSearchingUsda ? (
                    <p className="text-[13px] text-surface-400 py-1">Searching USDA...</p>
                  ) : usdaError ? (
                    <p className="text-[13px] text-surface-500 py-1">{usdaError}</p>
                  ) : usdaResults.length === 0 ? (
                    <p className="text-[13px] text-surface-500 py-1">No USDA results</p>
                  ) : (
                    <div className="space-y-1">
                      {usdaResults.map((food, idx) => (
                        <button
                          key={food.foodId ?? idx}
                          onClick={() => handleSelectFood(food)}
                          className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-surface-200 truncate">{food.name}</p>
                            <p className="text-xs text-surface-500">{food.servingSize}</p>
                          </div>
                          <span className="text-xs text-surface-500 flex-shrink-0">
                            {food.calories} cal | {food.protein}g P
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {/* Barcode Scanner Tab */}
        {activeTab === 'barcode' && (
          <div className="space-y-4">
            {barcodeError && (
              <div className="p-3 text-sm text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg space-y-2">
                <p>{barcodeError}</p>
                {notFoundBarcode && onCreateCustomFood && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const barcode = notFoundBarcode;
                      resetAndClose();
                      onCreateCustomFood(barcode);
                    }}
                  >
                    Create custom food for this barcode
                  </Button>
                )}
              </div>
            )}

            {isLookingUpBarcode ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-surface-400">Looking up product...</div>
              </div>
            ) : scannedProduct && activeSelection ? (
              // Scanned Product with the shared AMOUNT + UNIT editor
              <div className="space-y-4">
                <div className="bg-surface-800 rounded-lg p-4 space-y-4" data-testid="add-food-detail">
                  {/* Product Image and Name */}
                  <div className="flex items-start gap-4">
                    {scannedProduct.imageUrl ? (
                      <div className="relative w-20 h-20 rounded-lg bg-white overflow-hidden">
                        <Image
                          src={scannedProduct.imageUrl}
                          alt={scannedProduct.name}
                          fill
                          className="object-contain"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="w-20 h-20 bg-surface-700 rounded-lg flex items-center justify-center">
                        <IconToolsKitchen2 size={28} className="text-surface-400" aria-hidden="true" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-surface-100 text-lg leading-tight">
                        {scannedProduct.name}
                      </h3>
                      {scannedProduct.brand && (
                        <p className="text-sm text-surface-400 mt-1">
                          {scannedProduct.brand}
                        </p>
                      )}
                      <p className="text-xs text-surface-500 mt-1">
                        Base: {scannedProduct.servingSize}
                      </p>
                    </div>
                  </div>

                  <ServingAmountEditor
                    model={activeSelection.model}
                    value={amountValue}
                    onChange={setAmountValue}
                    recentAmounts={recentAmounts}
                    testIdPrefix="add-food"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    onClick={handleScanAgain}
                    variant="secondary"
                    className="flex-1"
                  >
                    Scan again
                  </Button>
                  <Button
                    onClick={handleAddSelection}
                    variant="primary"
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {isSubmitting ? 'Adding...' : 'Add food'}
                  </Button>
                </div>
              </div>
            ) : (
              <BarcodeScanner
                onScan={handleBarcodeScanned}
                onClose={() => setActiveTab('search')}
              />
            )}
          </div>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Food name *
              </label>
              <Input
                value={manualFood.food_name}
                onChange={(e) => setManualFood({ ...manualFood, food_name: e.target.value })}
                placeholder="e.g., Grilled Chicken"
              />
            </div>

            {/* Amount + unit (matches the editor's layout for consistency) */}
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Amount
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={manualFood.amount}
                  onChange={(e) => setManualFood({ ...manualFood, amount: e.target.value })}
                  className="flex-1"
                  data-testid="manual-amount"
                />
                <Input
                  value={manualFood.unit}
                  onChange={(e) => setManualFood({ ...manualFood, unit: e.target.value })}
                  placeholder="serving, g, oz…"
                  className="flex-1"
                  data-testid="manual-unit"
                />
              </div>
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
                  value={manualFood.calories}
                  onChange={(e) => setManualFood({ ...manualFood, calories: e.target.value })}
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
                  value={manualFood.protein}
                  onChange={(e) => setManualFood({ ...manualFood, protein: e.target.value })}
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
                  value={manualFood.carbs}
                  onChange={(e) => setManualFood({ ...manualFood, carbs: e.target.value })}
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
                  value={manualFood.fat}
                  onChange={(e) => setManualFood({ ...manualFood, fat: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>

            <Button
              onClick={handleAddManualFood}
              variant="primary"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Adding...' : 'Add to log'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

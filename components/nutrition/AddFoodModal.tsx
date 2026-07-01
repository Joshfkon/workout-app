'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { searchFoods, type FoodSearchResult, type FoodSearchResultWithServings, type ParsedServing } from '@/services/usdaService';
import { getFoodDetails } from '@/services/usdaService';
import { lookupBarcode as lookupBarcodeOFF } from '@/services/openFoodFactsService';
import { BarcodeScanner } from './BarcodeScanner';
import { IconSearch, IconScan, IconPencil, IconX, IconToolsKitchen2 } from '@tabler/icons-react';
import type { MealType, CustomFood, FrequentFood, SystemFood } from '@/types/nutrition';

// Serving unit options for scanned foods
type ServingUnit = 'grams' | 'serving' | 'pieces';

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

  // Form state
  const [servings, setServings] = useState('1');
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [weightAmount, setWeightAmount] = useState('100');
  const [weightUnit, setWeightUnit] = useState<'g' | 'oz'>('g');

  // Manual entry
  const [manualFood, setManualFood] = useState({
    food_name: '',
    serving_size: '1 serving',
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
  const [selectedServingIndex, setSelectedServingIndex] = useState(0);

  // Scanned product state
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(null);
  const [scannedQuantity, setScannedQuantity] = useState('1');
  const [scannedUnit, setScannedUnit] = useState<ServingUnit>('serving');

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
    searchFoods(debouncedQuery)
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
        // Set the scanned product for serving selection
        setScannedProduct({
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
        });
        setScannedQuantity('1');
        setScannedUnit('serving');
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
    setServings('1');
    setSelectedServingIndex(0);

    // If the food has a foodId, fetch detailed info with serving options
    const hasServings = 'servings' in food && Array.isArray((food as FoodSearchResultWithServings).servings);
    if (food.foodId && !hasServings) {
      setIsLoadingDetails(true);
      try {
        const result = await getFoodDetails(food.foodId);
        if (result.food) {
          setSelectedFood(result.food);
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
    setServings('1');
    // Set weight to match the food's reference amount if it's per-weight
    if (food.is_per_weight && food.reference_amount) {
      setWeightAmount(food.reference_amount.toString());
      setWeightUnit(food.reference_unit || 'g');
    } else {
      setWeightAmount('100');
      setWeightUnit('g');
    }
  };

  const handleSelectSystemFood = (food: SystemFood) => {
    setSelectedSystemFood(food);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setWeightAmount('100');
    setWeightUnit('g');
  };

  const handleAddSystemFood = async () => {
    if (!selectedSystemFood) return;

    setIsSubmitting(true);
    setError('');

    try {
      const inputAmount = parseFloat(weightAmount) || 100;
      // Convert oz to grams if needed
      const gramsAmount = weightUnit === 'oz' ? inputAmount * 28.3495 : inputAmount;
      const multiplier = gramsAmount / 100;

      await onAdd({
        food_name: selectedSystemFood.name,
        serving_size: `${inputAmount}${weightUnit}`,
        servings: 1,
        calories: Math.round(selectedSystemFood.calories_per_100g * multiplier),
        protein: Math.round(selectedSystemFood.protein_per_100g * multiplier * 10) / 10,
        carbs: Math.round(selectedSystemFood.carbs_per_100g * multiplier * 10) / 10,
        fat: Math.round(selectedSystemFood.fat_per_100g * multiplier * 10) / 10,
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

  const handleAddSelectedFood = async () => {
    if (!selectedFood) return;

    const servingsNum = parseFloat(servings);
    if (!servingsNum || servingsNum <= 0) {
      setError('Please enter a valid serving amount');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Use selected serving if available
      const foodWithServings = selectedFood as FoodSearchResultWithServings;
      const serving: ParsedServing | undefined = foodWithServings.servings?.[selectedServingIndex];
      const calories = serving ? serving.calories : selectedFood.calories;
      const protein = serving ? serving.protein : selectedFood.protein;
      const carbs = serving ? serving.carbs : selectedFood.carbs;
      const fat = serving ? serving.fat : selectedFood.fat;
      const servingSize = serving ? serving.description : selectedFood.servingSize;

      await onAdd({
        food_name: selectedFood.name,
        serving_size: servingSize,
        servings: servingsNum,
        calories: Math.round(calories * servingsNum),
        protein: Math.round(protein * servingsNum * 10) / 10,
        carbs: Math.round(carbs * servingsNum * 10) / 10,
        fat: Math.round(fat * servingsNum * 10) / 10,
        meal_type: mealType,
        source: 'usda',
        food_id: selectedFood.foodId,
      });

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddCustomFood = async () => {
    if (!selectedCustomFood) return;

    setIsSubmitting(true);
    setError('');

    try {
      if (selectedCustomFood.is_per_weight && selectedCustomFood.reference_amount && selectedCustomFood.calories_per_ref) {
        // Calculate from weight input
        const inputAmount = parseFloat(weightAmount) || 0;
        const refAmount = selectedCustomFood.reference_amount;
        const refUnit = selectedCustomFood.reference_unit || 'g';

        // Convert input to same unit as reference if needed
        let normalizedInput = inputAmount;
        if (weightUnit !== refUnit) {
          // Convert between grams and ounces
          if (weightUnit === 'oz' && refUnit === 'g') {
            normalizedInput = inputAmount * 28.3495; // oz to g
          } else if (weightUnit === 'g' && refUnit === 'oz') {
            normalizedInput = inputAmount / 28.3495; // g to oz
          }
        }

        const multiplier = normalizedInput / refAmount;

        await onAdd({
          food_name: selectedCustomFood.food_name,
          serving_size: `${inputAmount}${weightUnit}`,
          servings: 1,
          calories: Math.round((selectedCustomFood.calories_per_ref || 0) * multiplier),
          protein: Math.round((selectedCustomFood.protein_per_ref || 0) * multiplier * 10) / 10,
          carbs: Math.round((selectedCustomFood.carbs_per_ref || 0) * multiplier * 10) / 10,
          fat: Math.round((selectedCustomFood.fat_per_ref || 0) * multiplier * 10) / 10,
          meal_type: mealType,
          source: 'custom',
        });
      } else {
        // Use per-serving values
        const servingsNum = parseFloat(servings);
        if (!servingsNum || servingsNum <= 0) {
          setError('Please enter a valid serving amount');
          setIsSubmitting(false);
          return;
        }

        await onAdd({
          food_name: selectedCustomFood.food_name,
          serving_size: selectedCustomFood.serving_size || '1 serving',
          servings: servingsNum,
          calories: Math.round(selectedCustomFood.calories * servingsNum),
          protein: Math.round((selectedCustomFood.protein || 0) * servingsNum * 10) / 10,
          carbs: Math.round((selectedCustomFood.carbs || 0) * servingsNum * 10) / 10,
          fat: Math.round((selectedCustomFood.fat || 0) * servingsNum * 10) / 10,
          meal_type: mealType,
          source: 'custom',
        });
      }

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
      await onAdd({
        food_name: manualFood.food_name,
        serving_size: manualFood.serving_size,
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

  const resetAndClose = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setUsdaResults([]);
    setUsdaError('');
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    setServings('1');
    setWeightAmount('100');
    setWeightUnit('g');
    setManualFood({
      food_name: '',
      serving_size: '1 serving',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
    });
    setError('');
    setBarcodeError('');
    setNotFoundBarcode(null);
    setSelectedServingIndex(0);
    // Reset scanned product state
    setScannedProduct(null);
    setScannedQuantity('1');
    setScannedUnit('serving');
    onClose();
  };

  // Calculate live nutrition for system foods
  const systemFoodNutrition = useMemo(() => {
    if (!selectedSystemFood) return null;

    const inputAmount = parseFloat(weightAmount) || 0;
    // Convert oz to grams if needed
    const gramsAmount = weightUnit === 'oz' ? inputAmount * 28.3495 : inputAmount;
    const multiplier = gramsAmount / 100;

    return {
      calories: Math.round(selectedSystemFood.calories_per_100g * multiplier),
      protein: Math.round(selectedSystemFood.protein_per_100g * multiplier * 10) / 10,
      carbs: Math.round(selectedSystemFood.carbs_per_100g * multiplier * 10) / 10,
      fat: Math.round(selectedSystemFood.fat_per_100g * multiplier * 10) / 10,
    };
  }, [selectedSystemFood, weightAmount, weightUnit]);

  // Calculate live nutrition for per-weight custom foods
  const customFoodNutrition = useMemo(() => {
    if (!selectedCustomFood?.is_per_weight || !selectedCustomFood.reference_amount) return null;

    const inputAmount = parseFloat(weightAmount) || 0;
    const refAmount = selectedCustomFood.reference_amount;
    const refUnit = selectedCustomFood.reference_unit || 'g';

    // Convert input to same unit as reference if needed
    let normalizedInput = inputAmount;
    if (weightUnit !== refUnit) {
      if (weightUnit === 'oz' && refUnit === 'g') {
        normalizedInput = inputAmount * 28.3495; // oz to g
      } else if (weightUnit === 'g' && refUnit === 'oz') {
        normalizedInput = inputAmount / 28.3495; // g to oz
      }
    }

    const multiplier = normalizedInput / refAmount;

    return {
      calories: Math.round((selectedCustomFood.calories_per_ref || 0) * multiplier),
      protein: Math.round((selectedCustomFood.protein_per_ref || 0) * multiplier * 10) / 10,
      carbs: Math.round((selectedCustomFood.carbs_per_ref || 0) * multiplier * 10) / 10,
      fat: Math.round((selectedCustomFood.fat_per_ref || 0) * multiplier * 10) / 10,
    };
  }, [selectedCustomFood, weightAmount, weightUnit]);

  // Calculate live nutrition for the selected USDA food
  const usdaNutrition = useMemo(() => {
    if (!selectedFood) return null;
    const serving = (selectedFood as FoodSearchResultWithServings).servings?.[selectedServingIndex];
    const base = serving ?? selectedFood;
    const servingsNum = parseFloat(servings) || 0;
    return {
      calories: Math.round(base.calories * servingsNum),
      protein: Math.round(base.protein * servingsNum * 10) / 10,
      carbs: Math.round(base.carbs * servingsNum * 10) / 10,
      fat: Math.round(base.fat * servingsNum * 10) / 10,
    };
  }, [selectedFood, selectedServingIndex, servings]);

  // Calculate live nutrition for scanned products
  const scannedProductNutrition = useMemo(() => {
    if (!scannedProduct) return null;

    const qty = parseFloat(scannedQuantity) || 0;
    let multiplier = 0;

    // Calculate multiplier based on unit selection
    // Base nutrition is stored per serving (servingQuantity grams)
    switch (scannedUnit) {
      case 'serving':
        // qty servings
        multiplier = qty;
        break;
      case 'grams':
        // qty grams - convert to servings
        multiplier = qty / scannedProduct.servingQuantity;
        break;
      case 'pieces':
        // For pieces, assume same as serving
        multiplier = qty;
        break;
    }

    return {
      calories: Math.round(scannedProduct.calories * multiplier),
      protein: Math.round(scannedProduct.protein * multiplier * 10) / 10,
      carbs: Math.round(scannedProduct.carbs * multiplier * 10) / 10,
      fat: Math.round(scannedProduct.fat * multiplier * 10) / 10,
    };
  }, [scannedProduct, scannedQuantity, scannedUnit]);

  // Get display text for serving size
  const getServingSizeDisplay = () => {
    if (!scannedProduct) return '';
    const qty = parseFloat(scannedQuantity) || 0;

    switch (scannedUnit) {
      case 'serving':
        return `${qty} ${qty === 1 ? 'serving' : 'servings'} (${Math.round(scannedProduct.servingQuantity * qty)}g)`;
      case 'grams':
        return `${qty}g`;
      case 'pieces':
        return `${qty} ${qty === 1 ? 'piece' : 'pieces'}`;
      default:
        return scannedProduct.servingSize;
    }
  };

  // Handle adding scanned product
  const handleAddScannedProduct = async () => {
    if (!scannedProduct || !scannedProductNutrition) return;

    setIsSubmitting(true);
    setError('');

    try {
      await onAdd({
        food_name: scannedProduct.name,
        serving_size: getServingSizeDisplay(),
        servings: 1, // We've already calculated the total
        calories: scannedProductNutrition.calories,
        protein: scannedProductNutrition.protein,
        carbs: scannedProductNutrition.carbs,
        fat: scannedProductNutrition.fat,
        meal_type: mealType,
        source: 'nutritionix', // Using this as generic barcode source
        barcode: scannedProduct.barcode,
      });

      resetAndClose();
    } catch {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle scan again
  const handleScanAgain = () => {
    setScannedProduct(null);
    setScannedQuantity('1');
    setScannedUnit('serving');
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
                setSelectedFood(null);
                setSelectedCustomFood(null);
                setSelectedSystemFood(null);
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

            {/* Selected USDA food */}
            {selectedFood && (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium text-surface-100">{selectedFood.name}</h3>
                    <p className="text-xs text-primary-400">
                      {(selectedFood as FoodSearchResultWithServings).servings?.[selectedServingIndex]?.description ?? selectedFood.servingSize}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedFood(null)}
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
                    {/* Serving option selector (when USDA provides portions) */}
                    {(selectedFood as FoodSearchResultWithServings).servings &&
                      (selectedFood as FoodSearchResultWithServings).servings.length > 1 && (
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-1">
                            Serving option
                          </label>
                          <select
                            value={selectedServingIndex}
                            onChange={(e) => setSelectedServingIndex(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          >
                            {(selectedFood as FoodSearchResultWithServings).servings.map((serving, index) => (
                              <option key={index} value={index}>
                                {serving.description} ({serving.calories} cal)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-1">
                        Number of servings
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={servings}
                        onChange={(e) => setServings(e.target.value)}
                      />
                    </div>

                    {usdaNutrition && (
                      <div className="grid grid-cols-4 gap-2 text-sm p-3 bg-surface-900/50 rounded-lg">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-surface-100">{usdaNutrition.calories}</p>
                          <p className="text-xs text-surface-400">Calories</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{usdaNutrition.protein}g</p>
                          <p className="text-xs text-surface-400">Protein</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{usdaNutrition.carbs}g</p>
                          <p className="text-xs text-surface-400">Carbs</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{usdaNutrition.fat}g</p>
                          <p className="text-xs text-surface-400">Fat</p>
                        </div>
                      </div>
                    )}

                    <Button
                      onClick={handleAddSelectedFood}
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

            {/* Selected custom food */}
            {selectedCustomFood && (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-surface-100">{selectedCustomFood.food_name}</h3>
                    <p className="text-xs text-primary-400">
                      {selectedCustomFood.is_per_weight
                        ? `Per ${selectedCustomFood.reference_amount}${selectedCustomFood.reference_unit || 'g'}`
                        : selectedCustomFood.serving_size}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedCustomFood(null)}
                    className="text-surface-400 hover:text-surface-200"
                    aria-label="Clear selection"
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>

                {selectedCustomFood.is_per_weight ? (
                  <>
                    {/* Weight Input with Live Calculation */}
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-1">
                        Your portion (weighed)
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={weightAmount}
                          onChange={(e) => setWeightAmount(e.target.value)}
                          className="flex-1"
                        />
                        <select
                          value={weightUnit}
                          onChange={(e) => setWeightUnit(e.target.value as 'g' | 'oz')}
                          className="px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                          <option value="g">grams</option>
                          <option value="oz">oz</option>
                        </select>
                      </div>
                    </div>

                    {/* Live Calculated Nutrition */}
                    {customFoodNutrition && (
                      <div className="grid grid-cols-4 gap-2 text-sm p-3 bg-surface-900/50 rounded-lg">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-surface-100">{customFoodNutrition.calories}</p>
                          <p className="text-xs text-surface-400">Calories</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{customFoodNutrition.protein}g</p>
                          <p className="text-xs text-surface-400">Protein</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{customFoodNutrition.carbs}g</p>
                          <p className="text-xs text-surface-400">Carbs</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-medium text-surface-100">{customFoodNutrition.fat}g</p>
                          <p className="text-xs text-surface-400">Fat</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Nutrition Info */}
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <p className="text-surface-400">Calories</p>
                        <p className="font-medium text-surface-100">{selectedCustomFood.calories}</p>
                      </div>
                      <div>
                        <p className="text-surface-400">Protein</p>
                        <p className="font-medium text-surface-100">{selectedCustomFood.protein || 0}g</p>
                      </div>
                      <div>
                        <p className="text-surface-400">Carbs</p>
                        <p className="font-medium text-surface-100">{selectedCustomFood.carbs || 0}g</p>
                      </div>
                      <div>
                        <p className="text-surface-400">Fat</p>
                        <p className="font-medium text-surface-100">{selectedCustomFood.fat || 0}g</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-1">
                        Number of servings
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={servings}
                        onChange={(e) => setServings(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <Button
                  onClick={handleAddCustomFood}
                  variant="primary"
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? 'Adding...' : 'Add to log'}
                </Button>
              </div>
            )}

            {/* Selected system food */}
            {selectedSystemFood && (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-surface-100">{selectedSystemFood.name}</h3>
                    <p className="text-xs text-primary-400">
                      {selectedSystemFood.calories_per_100g} cal per 100g
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedSystemFood(null)}
                    className="text-surface-400 hover:text-surface-200"
                    aria-label="Clear selection"
                  >
                    <IconX size={16} aria-hidden="true" />
                  </button>
                </div>

                {/* Weight Input */}
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-1">
                    Your portion (weighed)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={weightAmount}
                      onChange={(e) => setWeightAmount(e.target.value)}
                      className="flex-1"
                    />
                    <select
                      value={weightUnit}
                      onChange={(e) => setWeightUnit(e.target.value as 'g' | 'oz')}
                      className="px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="g">grams</option>
                      <option value="oz">oz</option>
                    </select>
                  </div>
                </div>

                {/* Live Calculated Nutrition */}
                {systemFoodNutrition && (
                  <div className="grid grid-cols-4 gap-2 text-sm p-3 bg-surface-900/50 rounded-lg">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-surface-100">{systemFoodNutrition.calories}</p>
                      <p className="text-xs text-surface-400">Calories</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-surface-100">{systemFoodNutrition.protein}g</p>
                      <p className="text-xs text-surface-400">Protein</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-surface-100">{systemFoodNutrition.carbs}g</p>
                      <p className="text-xs text-surface-400">Carbs</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-surface-100">{systemFoodNutrition.fat}g</p>
                      <p className="text-xs text-surface-400">Fat</p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleAddSystemFood}
                  variant="primary"
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? 'Adding...' : 'Add to log'}
                </Button>
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
            ) : scannedProduct ? (
              // Scanned Product with Serving Selection
              <div className="space-y-4">
                {/* Product Info */}
                <div className="bg-surface-800 rounded-lg p-4 space-y-4">
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

                  {/* Serving Size Selector */}
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-surface-300">
                      Amount
                    </label>
                    <div className="flex gap-2">
                      {/* Quantity Input with +/- buttons */}
                      <div className="flex items-center bg-surface-900 rounded-lg border border-surface-700">
                        <button
                          type="button"
                          onClick={() => {
                            const current = parseFloat(scannedQuantity) || 1;
                            setScannedQuantity(Math.max(0.5, current - 0.5).toString());
                          }}
                          className="px-3 py-2 text-surface-300 hover:text-surface-100 hover:bg-surface-700 rounded-l-lg transition-colors"
                        >
                          -
                        </button>
                        <Input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={scannedQuantity}
                          onChange={(e) => setScannedQuantity(e.target.value)}
                          className="w-20 text-center border-0 bg-transparent focus:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const current = parseFloat(scannedQuantity) || 1;
                            setScannedQuantity((current + 0.5).toString());
                          }}
                          className="px-3 py-2 text-surface-300 hover:text-surface-100 hover:bg-surface-700 rounded-r-lg transition-colors"
                        >
                          +
                        </button>
                      </div>

                      {/* Unit Selector */}
                      <select
                        value={scannedUnit}
                        onChange={(e) => setScannedUnit(e.target.value as ServingUnit)}
                        className="flex-1 px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="serving">Serving ({scannedProduct.servingQuantity}g)</option>
                        <option value="grams">Grams</option>
                        <option value="pieces">Pieces</option>
                      </select>
                    </div>

                    {/* Quick portion buttons */}
                    <div className="flex gap-2">
                      {[0.5, 1, 1.5, 2].map((qty) => (
                        <button
                          key={qty}
                          type="button"
                          onClick={() => setScannedQuantity(qty.toString())}
                          className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
                            scannedQuantity === qty.toString()
                              ? 'bg-primary-500 text-white'
                              : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                          }`}
                        >
                          {qty}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Live Nutrition Display */}
                  {scannedProductNutrition && (
                    <div className="grid grid-cols-4 gap-2 p-4 bg-surface-900/50 rounded-lg">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary-400">
                          {scannedProductNutrition.calories}
                        </p>
                        <p className="text-xs text-surface-400">cal</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-semibold text-surface-100">
                          {scannedProductNutrition.protein}g
                        </p>
                        <p className="text-xs text-surface-400">protein</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-semibold text-surface-100">
                          {scannedProductNutrition.carbs}g
                        </p>
                        <p className="text-xs text-surface-400">carbs</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-semibold text-surface-100">
                          {scannedProductNutrition.fat}g
                        </p>
                        <p className="text-xs text-surface-400">fat</p>
                      </div>
                    </div>
                  )}
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
                    onClick={handleAddScannedProduct}
                    variant="primary"
                    disabled={isSubmitting || !scannedProductNutrition?.calories}
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

            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Serving size
              </label>
              <Input
                value={manualFood.serving_size}
                onChange={(e) => setManualFood({ ...manualFood, serving_size: e.target.value })}
                placeholder="e.g., 4 oz"
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

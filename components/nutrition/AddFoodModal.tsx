'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { searchFoods, lookupBarcode, getFoodDetails, type FoodSearchResult, type FoodSearchResultWithServings, type ParsedServing } from '@/services/usdaService';
import { BarcodeScanner } from './BarcodeScanner';
import type { MealType, CustomFood, FrequentFood, SystemFood } from '@/types/nutrition';

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
  }) => Promise<void>;
  defaultMealType: MealType;
  recentFoods?: FoodSearchResult[];
  customFoods?: CustomFood[];
  frequentFoods?: FrequentFood[];
  systemFoods?: SystemFood[];
}

type Tab = 'quick' | 'barcode' | 'custom' | 'manual';

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  protein: { label: 'Proteins', emoji: '🥩' },
  carbs: { label: 'Carbs', emoji: '🍚' },
  fats: { label: 'Fats', emoji: '🥜' },
  vegetables: { label: 'Vegetables', emoji: '🥦' },
  fruits: { label: 'Fruits', emoji: '🍎' },
  supplements: { label: 'Supplements', emoji: '💪' },
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export function AddFoodModal({
  isOpen,
  onClose,
  onAdd,
  defaultMealType,
  recentFoods = [],
  customFoods = [],
  frequentFoods = [],
  systemFoods = [],
}: AddFoodModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('quick');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | FoodSearchResultWithServings | null>(null);
  const [selectedCustomFood, setSelectedCustomFood] = useState<CustomFood | null>(null);
  const [selectedSystemFood, setSelectedSystemFood] = useState<SystemFood | null>(null);
  const [systemFoodCategory, setSystemFoodCategory] = useState<string>('all');

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
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedServingIndex, setSelectedServingIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');

  // Reset meal type when modal opens
  useEffect(() => {
    if (isOpen) {
      setMealType(defaultMealType);
    }
  }, [isOpen, defaultMealType]);

  // Get frequent foods for the selected meal type
  const frequentFoodsForMeal = useMemo(() => {
    return frequentFoods
      .filter(f => f.meal_type === mealType)
      .sort((a, b) => b.times_logged - a.times_logged)
      .slice(0, 5);
  }, [frequentFoods, mealType]);

  // Filter custom foods based on search
  const filteredCustomFoods = useMemo(() => {
    if (!filterQuery.trim()) return customFoods;
    const query = filterQuery.toLowerCase();
    return customFoods.filter(f => 
      f.food_name.toLowerCase().includes(query)
    );
  }, [customFoods, filterQuery]);

  // Filter recent foods based on search
  const filteredRecentFoods = useMemo(() => {
    if (!filterQuery.trim()) return recentFoods;
    const query = filterQuery.toLowerCase();
    return recentFoods.filter(f => 
      f.name.toLowerCase().includes(query)
    );
  }, [recentFoods, filterQuery]);

  // Filter system foods based on category and search
  const filteredSystemFoods = useMemo(() => {
    let foods = systemFoods;
    
    if (systemFoodCategory !== 'all') {
      foods = foods.filter(f => f.category === systemFoodCategory);
    }
    
    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase();
      foods = foods.filter(f => f.name.toLowerCase().includes(query));
    }
    
    return foods;
  }, [systemFoods, systemFoodCategory, filterQuery]);

  // Group system foods by category for display
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
    setIsLookingUpBarcode(true);

    try {
      const result = await lookupBarcode(barcode);
      if (result.error) {
        setBarcodeError(result.error);
      } else if (result.food) {
        setSelectedFood(result.food);
        setServings('1');
        setActiveTab('search'); // Switch back to show the food details
      }
    } catch (err) {
      setBarcodeError('Failed to lookup barcode. Please try again.');
    } finally {
      setIsLookingUpBarcode(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const result = await searchFoods(searchQuery);
      if (result.error) {
        setSearchError(result.error);
      } else {
        setSearchResults(result.foods);
        if (result.foods.length === 0) {
          setSearchError('No foods found. Try a different search or add manually.');
        }
      }
    } catch (err) {
      setSearchError('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectFood = async (food: FoodSearchResult) => {
    setSelectedFood(food);
    setSelectedCustomFood(null);
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      setError('Failed to add food. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedFood(null);
    setSelectedCustomFood(null);
    setSelectedSystemFood(null);
    setServings('1');
    setWeightAmount('100');
    setWeightUnit('g');
    setFilterQuery('');
    setSystemFoodCategory('all');
    setManualFood({
      food_name: '',
      serving_size: '1 serving',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
    });
    setError('');
    setSearchError('');
    setSelectedServingIndex(0);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add Food"
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

        {/* Frequent Foods for this Meal */}
        {frequentFoodsForMeal.length > 0 && !selectedFood && !selectedCustomFood && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-surface-400 uppercase tracking-wide">
              Your {MEAL_LABELS[mealType]} Foods
            </p>
            <div className="space-y-1">
              {frequentFoodsForMeal.map((food, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAddFrequentFood(food)}
                  disabled={isSubmitting}
                  className="w-full p-2 bg-surface-800/50 hover:bg-surface-700 rounded-lg text-left transition-colors flex justify-between items-center disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-medium text-surface-200">{food.food_name}</p>
                    <p className="text-xs text-surface-500">
                      {Math.round(food.avg_calories)} cal • {food.times_logged}x logged
                    </p>
                  </div>
                  <span className="text-primary-400 text-sm">+ Add</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b border-surface-800 overflow-x-auto">
          {([
            { id: 'quick' as Tab, label: '⚡ Quick Add' },
            { id: 'barcode' as Tab, label: '📷 Barcode' },
            { id: 'custom' as Tab, label: '📁 Custom' },
            { id: 'manual' as Tab, label: '✏️ Manual' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedFood(null);
                setSelectedCustomFood(null);
                setSelectedSystemFood(null);
                setFilterQuery('');
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Quick Add Tab - System Foods */}
        {activeTab === 'quick' && (
          <div className="space-y-4">
            {/* Search and Category Filter */}
            <div className="flex gap-2">
              <Input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Search foods..."
                className="flex-1"
              />
              <select
                value={systemFoodCategory}
                onChange={(e) => setSystemFoodCategory(e.target.value)}
                className="px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All</option>
                <option value="protein">🥩 Proteins</option>
                <option value="carbs">🍚 Carbs</option>
                <option value="fats">🥜 Fats</option>
                <option value="vegetables">🥦 Vegetables</option>
                <option value="fruits">🍎 Fruits</option>
                <option value="supplements">💪 Supplements</option>
              </select>
            </div>

            {selectedSystemFood ? (
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
                  >
                    ✕
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
                  {isSubmitting ? 'Adding...' : 'Add to Log'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {systemFoodCategory === 'all' ? (
                  // Show grouped by category
                  Object.entries(groupedSystemFoods).map(([category, foods]) => (
                    <div key={category}>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2 sticky top-0 bg-surface-900 py-1">
                        {CATEGORY_LABELS[category]?.emoji} {CATEGORY_LABELS[category]?.label || category}
                      </p>
                      <div className="space-y-1">
                        {foods.slice(0, 10).map((food) => (
                          <button
                            key={food.id}
                            onClick={() => handleSelectSystemFood(food)}
                            className="w-full p-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors"
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
                  ))
                ) : (
                  // Show flat list for filtered category
                  <div className="space-y-1">
                    {filteredSystemFoods.map((food) => (
                      <button
                        key={food.id}
                        onClick={() => handleSelectSystemFood(food)}
                        className="w-full p-3 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-medium text-surface-100">{food.name}</h4>
                            <p className="text-sm text-surface-400">per 100g</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-surface-100">{food.calories_per_100g} cal</p>
                            <p className="text-sm text-surface-400">{food.protein_per_100g}g protein</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {filteredSystemFoods.length === 0 && (
                  <p className="text-center text-surface-400 py-8">
                    No foods found matching your search
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Barcode Scanner Tab */}
        {activeTab === 'barcode' && (
          <div className="space-y-4">
            {barcodeError && (
              <div className="p-3 text-sm text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                {barcodeError}
              </div>
            )}

            {isLookingUpBarcode ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-surface-400">Looking up product...</div>
              </div>
            ) : (
              <BarcodeScanner
                onScan={handleBarcodeScanned}
                onClose={() => setActiveTab('quick')}
              />
            )}
          </div>
        )}


        {/* Custom Foods Tab */}
        {activeTab === 'custom' && (
          <div className="space-y-4">
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter custom foods..."
              className="w-full"
            />
            
            {selectedCustomFood ? (
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
                  >
                    ✕
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
                        Number of Servings
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
                  {isSubmitting ? 'Adding...' : 'Add to Log'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredCustomFoods.length === 0 ? (
                  <p className="text-center text-surface-400 py-8">
                    {filterQuery ? 'No matching custom foods' : 'No custom foods yet'}
                  </p>
                ) : (
                  filteredCustomFoods.map((food) => (
                    <button
                      key={food.id}
                      onClick={() => handleSelectCustomFood(food)}
                      className="w-full p-3 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-surface-100">{food.food_name}</h4>
                          <p className="text-sm text-surface-400">
                            {food.is_per_weight 
                              ? `${food.calories_per_ref} cal per ${food.reference_amount}${food.reference_unit || 'g'}`
                              : food.serving_size
                            }
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-surface-100">
                            {food.is_per_weight 
                              ? `${food.protein_per_ref || 0}g`
                              : `${food.calories} cal`
                            }
                          </p>
                          <p className="text-sm text-surface-400">
                            {food.is_per_weight 
                              ? `protein/${food.reference_amount}${food.reference_unit || 'g'}`
                              : `${food.protein || 0}g protein`
                            }
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Food Name *
              </label>
              <Input
                value={manualFood.food_name}
                onChange={(e) => setManualFood({ ...manualFood, food_name: e.target.value })}
                placeholder="e.g., Grilled Chicken"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">
                Serving Size
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
              {isSubmitting ? 'Adding...' : 'Add to Log'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

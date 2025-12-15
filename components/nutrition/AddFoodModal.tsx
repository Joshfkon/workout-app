'use client';

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { searchFoods, lookupBarcode, getFoodDetails, type FoodSearchResult, type FoodSearchResultWithServings, type ParsedServing } from '@/services/fatSecretService';
import { BarcodeScanner } from './BarcodeScanner';
import type { MealType, CustomFood } from '@/types/nutrition';

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
}

type Tab = 'search' | 'recent' | 'custom' | 'manual' | 'barcode';

export function AddFoodModal({
  isOpen,
  onClose,
  onAdd,
  defaultMealType,
  recentFoods = [],
  customFoods = [],
}: AddFoodModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | FoodSearchResultWithServings | null>(null);

  // Form state
  const [servings, setServings] = useState('1');
  const [mealType, setMealType] = useState<MealType>(defaultMealType);

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

  const handleAddCustomFood = async (food: CustomFood) => {
    setIsSubmitting(true);
    setError('');

    try {
      await onAdd({
        food_name: food.food_name,
        serving_size: food.serving_size || '1 serving',
        servings: 1,
        calories: food.calories,
        protein: food.protein || 0,
        carbs: food.carbs || 0,
        fat: food.fat || 0,
        meal_type: mealType,
        source: 'custom',
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
    setServings('1');
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add Food"
      size="lg"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-surface-800 overflow-x-auto">
          {(['search', 'barcode', 'recent', 'custom', 'manual'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

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

        {error && (
          <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            {error}
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search foods (e.g., '2 eggs and toast')"
                className="flex-1"
              />
              <Button
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                variant="primary"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {searchError && (
              <p className="text-sm text-warning-400">{searchError}</p>
            )}

            {selectedFood ? (
              <div className="space-y-4 p-4 bg-surface-800 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-surface-100">{selectedFood.name}</h3>
                    {selectedFood.brandName && (
                      <p className="text-xs text-primary-400">{selectedFood.brandName}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedFood(null)}
                    className="text-surface-400 hover:text-surface-200"
                  >
                    ✕
                  </button>
                </div>

                {isLoadingDetails ? (
                  <div className="text-center py-4 text-surface-400">
                    Loading serving options...
                  </div>
                ) : (
                  <>
                    {/* Serving Size Selector */}
                    {(() => {
                      const foodWithServings = selectedFood as FoodSearchResultWithServings;
                      const servings = foodWithServings.servings;
                      if (!servings || servings.length <= 1) return null;
                      return (
                        <div>
                          <label className="block text-sm font-medium text-surface-300 mb-1">
                            Serving Size
                          </label>
                          <select
                            value={selectedServingIndex}
                            onChange={(e) => setSelectedServingIndex(parseInt(e.target.value))}
                            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          >
                            {servings.map((serving, idx) => (
                              <option key={idx} value={idx}>
                                {serving.description} ({serving.calories} cal)
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}

                    {/* Nutrition Info */}
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      {(() => {
                        const foodWithServings = selectedFood as FoodSearchResultWithServings;
                        const serving = foodWithServings.servings?.[selectedServingIndex];
                        const cal = serving?.calories ?? selectedFood.calories;
                        const prot = serving?.protein ?? selectedFood.protein;
                        const carb = serving?.carbs ?? selectedFood.carbs;
                        const f = serving?.fat ?? selectedFood.fat;
                        return (
                          <>
                            <div>
                              <p className="text-surface-400">Calories</p>
                              <p className="font-medium text-surface-100">{cal}</p>
                            </div>
                            <div>
                              <p className="text-surface-400">Protein</p>
                              <p className="font-medium text-surface-100">{prot}g</p>
                            </div>
                            <div>
                              <p className="text-surface-400">Carbs</p>
                              <p className="font-medium text-surface-100">{carb}g</p>
                            </div>
                            <div>
                              <p className="text-surface-400">Fat</p>
                              <p className="font-medium text-surface-100">{f}g</p>
                            </div>
                          </>
                        );
                      })()}
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

                    <Button
                      onClick={handleAddSelectedFood}
                      variant="primary"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Adding...' : 'Add to Log'}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {searchResults.map((food, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectFood(food)}
                    className="w-full p-3 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-surface-100">{food.name}</h4>
                        <p className="text-sm text-surface-400">{food.servingSize}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-surface-100">{food.calories} cal</p>
                        <p className="text-sm text-surface-400">{food.protein}g protein</p>
                      </div>
                    </div>
                  </button>
                ))}
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
                onClose={() => setActiveTab('search')}
              />
            )}
          </div>
        )}

        {/* Recent Foods Tab */}
        {activeTab === 'recent' && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recentFoods.length === 0 ? (
              <p className="text-center text-surface-400 py-8">No recent foods yet</p>
            ) : (
              recentFoods.slice(0, 20).map((food, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectFood(food)}
                  className="w-full p-3 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-surface-100">{food.name}</h4>
                      <p className="text-sm text-surface-400">{food.servingSize}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-surface-100">{food.calories} cal</p>
                      <p className="text-sm text-surface-400">{food.protein}g protein</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Custom Foods Tab */}
        {activeTab === 'custom' && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {customFoods.length === 0 ? (
              <p className="text-center text-surface-400 py-8">No custom foods yet</p>
            ) : (
              customFoods.map((food) => (
                <button
                  key={food.id}
                  onClick={() => handleAddCustomFood(food)}
                  disabled={isSubmitting}
                  className="w-full p-3 bg-surface-800 hover:bg-surface-700 rounded-lg text-left transition-colors disabled:opacity-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-surface-100">{food.food_name}</h4>
                      <p className="text-sm text-surface-400">{food.serving_size}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-surface-100">{food.calories} cal</p>
                      <p className="text-sm text-surface-400">{food.protein}g protein</p>
                    </div>
                  </div>
                </button>
              ))
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

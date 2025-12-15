'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { searchFoods, type FoodSearchResult } from '@/services/fatSecretService';

interface QuickFoodLoggerProps {
  onAdd: (food: {
    food_name: string;
    serving_size: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    source: 'usda' | 'manual';
  }) => Promise<void>;
  onClose: () => void;
}

export function QuickFoodLogger({ onAdd, onClose }: QuickFoodLoggerProps) {
  const [mode, setMode] = useState<'search' | 'manual'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');

  // Manual entry state
  const [manualName, setManualName] = useState('');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const result = await searchFoods(query);
      setResults((result.foods || []).slice(0, 5));
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleQuickAdd = async (food: FoodSearchResult) => {
    setIsAdding(true);
    try {
      await onAdd({
        food_name: food.name,
        serving_size: food.servingSize || '1 serving',
        servings: 1,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        meal_type: mealType,
        source: 'usda',
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

  return (
    <div className="p-4 bg-surface-800 rounded-xl border border-surface-700 space-y-4">
      {/* Meal Type Selector */}
      <div className="flex gap-1 bg-surface-900 p-1 rounded-lg">
        {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setMealType(type)}
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
      <div className="flex gap-2">
        <button
          onClick={() => setMode('search')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'search'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Search
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'manual'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Quick Entry
        </button>
      </div>

      {mode === 'search' ? (
        <>
          {/* Search Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search foods..."
              className="flex-1 px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-100 placeholder-surface-500"
            />
            <Button
              onClick={handleSearch}
              isLoading={isSearching}
              size="sm"
            >
              Search
            </Button>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {results.map((food, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickAdd(food)}
                  disabled={isAdding}
                  className="w-full p-3 bg-surface-900 hover:bg-surface-700 rounded-lg text-left transition-colors disabled:opacity-50"
                >
                  <p className="text-sm font-medium text-surface-200 truncate">{food.name}</p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {food.calories} cal · P: {food.protein}g · C: {food.carbs}g · F: {food.fat}g
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
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


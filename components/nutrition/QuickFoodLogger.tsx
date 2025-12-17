'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { searchFoods, type FoodSearchResult } from '@/services/usdaService';
import { BarcodeScanner } from './BarcodeScanner';
import type { BarcodeSearchResult } from '@/services/openFoodFactsService';

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
    source: 'usda' | 'manual' | 'barcode';
  }) => Promise<void>;
  onClose: () => void;
}

export function QuickFoodLogger({ onAdd, onClose }: QuickFoodLoggerProps) {
  const [mode, setMode] = useState<'search' | 'manual' | 'barcode'>('search');
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

  // Barcode product state
  const [barcodeProduct, setBarcodeProduct] = useState<NonNullable<BarcodeSearchResult['product']> | null>(null);

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
      <div className="flex gap-1 bg-surface-900 p-1 rounded-lg">
        <button
          onClick={() => { setMode('search'); setBarcodeProduct(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'search'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search
        </button>
        <button
          onClick={() => { setMode('barcode'); setBarcodeProduct(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'barcode'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Scan
        </button>
        <button
          onClick={() => { setMode('manual'); setBarcodeProduct(null); }}
          className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${
            mode === 'manual'
              ? 'bg-surface-700 text-white'
              : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Manual
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
      ) : mode === 'barcode' ? (
        /* Barcode Scanner Mode */
        barcodeProduct ? (
          /* Show scanned product for confirmation */
          <div className="space-y-3">
            <div className="p-4 bg-surface-900 rounded-lg">
              {barcodeProduct.imageUrl && (
                <div className="flex justify-center mb-3">
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


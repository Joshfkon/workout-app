'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingAnimation } from '@/components/ui';
import { IconTrash, IconBookmark } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';

/** Shape of one denormalized item inside saved_meals.items (jsonb) */
export interface SavedMealItem {
  name: string;
  serving_size: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface SavedMeal {
  id: string;
  name: string;
  items: SavedMealItem[];
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  times_logged: number;
}

interface SavedMealRow {
  id: string;
  name: string;
  items: SavedMealItem[] | null;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  times_logged: number;
}

interface SavedMealsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Label of the time-appropriate meal a tap will log to, e.g. "Lunch" */
  targetMealLabel: string;
  /** Logs all items via the page's food_log insert path + increments times_logged */
  onLog: (meal: SavedMeal) => Promise<void>;
}

/**
 * Phase 4.2 "Meals" flow: lists saved_meals (RLS-scoped), one tap re-logs the
 * whole meal to the time-appropriate meal type; delete per row.
 */
export function SavedMealsModal({ isOpen, onClose, targetMealLabel, onLog }: SavedMealsModalProps) {
  const [meals, setMeals] = useState<SavedMeal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchMeals = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const supabase = createUntypedClient();
      const { data, error: fetchError } = await supabase
        .from('saved_meals')
        .select('id, name, items, total_calories, total_protein, total_carbs, total_fat, times_logged')
        .order('times_logged', { ascending: false })
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      const rows = (data ?? []) as SavedMealRow[];
      setMeals(
        rows.map((row) => ({
          ...row,
          items: Array.isArray(row.items) ? row.items : [],
        }))
      );
    } catch (err) {
      console.error('Error loading saved meals:', err);
      setError('Failed to load saved meals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchMeals();
    }
  }, [isOpen, fetchMeals]);

  const handleLog = async (meal: SavedMeal) => {
    if (loggingId) return;
    setLoggingId(meal.id);
    setError('');
    try {
      await onLog(meal);
      onClose();
    } catch (err) {
      console.error('Error logging saved meal:', err);
      setError('Failed to log meal. Please try again.');
    } finally {
      setLoggingId(null);
    }
  };

  const handleDelete = async (meal: SavedMeal) => {
    if (!confirm(`Delete "${meal.name}"?`)) return;
    try {
      const supabase = createUntypedClient();
      const { error: deleteError } = await supabase.from('saved_meals').delete().eq('id', meal.id);
      if (deleteError) throw deleteError;
      setMeals((prev) => prev.filter((m) => m.id !== meal.id));
    } catch (err) {
      console.error('Error deleting saved meal:', err);
      setError('Failed to delete meal');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Saved meals" size="lg">
      <div className="space-y-3">
        <p className="text-[11px] text-surface-500">One tap logs everything to {targetMealLabel}.</p>

        {error && <p className="text-[13px] text-danger-400">{error}</p>}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <LoadingAnimation type="dots" size="md" />
          </div>
        ) : meals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <IconBookmark size={20} className="text-surface-600" aria-hidden="true" />
            <p className="text-[13px] text-surface-400">No saved meals yet.</p>
            <p className="text-[11px] text-surface-500">
              Use the bookmark icon on a meal card to save it for one-tap logging.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {meals.map((meal) => (
              <div
                key={meal.id}
                className="flex items-center gap-2 rounded-lg bg-surface-800/50 p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-surface-100 truncate">{meal.name}</p>
                  <p className="text-[11px] text-surface-500">
                    {Math.round(meal.total_calories)} kcal · {Math.round(meal.total_protein)}p
                    {meal.times_logged > 0 ? ` · logged ${meal.times_logged}x` : ''}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleLog(meal)}
                  disabled={loggingId !== null}
                >
                  {loggingId === meal.id ? 'Logging...' : 'Log'}
                </Button>
                <button
                  type="button"
                  onClick={() => handleDelete(meal)}
                  className="p-1.5 text-surface-500 hover:text-danger-400 transition-colors flex-shrink-0"
                  aria-label={`Delete ${meal.name}`}
                >
                  <IconTrash size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

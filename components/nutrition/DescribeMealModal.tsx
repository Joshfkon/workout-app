'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconTrash } from '@tabler/icons-react';
import { parseMealDescription, type ParsedMealItem } from '@/lib/actions/nutrition-ai';
import { useAiConsentGate } from '@/components/ai/AiConsentGate';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { useAiFeatureLocked } from '@/hooks/useAiFeatureLocked';
import { AI_DAILY_LIMITS } from '@/lib/ai/rateLimit';
import type { MealType } from '@/types/nutrition';

const MEAL_OPTIONS: { type: MealType; label: string }[] = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch', label: 'Lunch' },
  { type: 'dinner', label: 'Dinner' },
  { type: 'snack', label: 'Snack' },
];

interface DescribeMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Time-of-day default computed by the page */
  defaultMealType: MealType;
  /** Logs every reviewed item through the page's food_log insert path */
  onLogItems: (items: ParsedMealItem[], mealType: MealType) => Promise<void>;
}

/**
 * Phase 4.2 "Describe" flow: free-text meal description -> parseMealDescription
 * server action -> editable review list -> one tap logs everything to the
 * selected meal.
 */
export function DescribeMealModal({
  isOpen,
  onClose,
  defaultMealType,
  onLogItems,
}: DescribeMealModalProps) {
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [description, setDescription] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const ensureAiConsent = useAiConsentGate();
  // Plan lacks AI meal logging: the free daily allowance applies.
  const onFreeAllowance = useAiFeatureLocked();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [parseError, setParseError] = useState('');
  const [items, setItems] = useState<ParsedMealItem[] | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [logError, setLogError] = useState('');

  // Reset the flow each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setMealType(defaultMealType);
      setDescription('');
      setItems(null);
      setParseError('');
      setShowUpgrade(false);
      setLogError('');
      setIsParsing(false);
      setIsLogging(false);
    }
  }, [isOpen, defaultMealType]);

  const handleParse = async () => {
    if (!description.trim() || isParsing) return;
    setIsParsing(true);
    setParseError('');
    try {
      // First AI use asks for consent; declined → nothing is sent.
      if (!(await ensureAiConsent())) return;
      const result = await parseMealDescription(description);
      if (result.ok) {
        setItems(result.items);
      } else {
        setParseError(result.error);
        setShowUpgrade(result.upgrade === true);
      }
    } catch {
      setParseError("Couldn't parse that description — try again");
    } finally {
      setIsParsing(false);
    }
  };

  const updateItem = (index: number, patch: Partial<ParsedMealItem>) => {
    setItems((prev) => (prev ? prev.map((item, i) => (i === index ? { ...item, ...patch } : item)) : prev));
  };

  const removeItem = (index: number) => {
    setItems((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleLog = async () => {
    if (!items || items.length === 0 || isLogging) return;
    setIsLogging(true);
    setLogError('');
    try {
      await onLogItems(
        items.filter((item) => item.name.trim().length > 0),
        mealType
      );
      onClose();
    } catch {
      setLogError('Failed to log items. Please try again.');
    } finally {
      setIsLogging(false);
    }
  };

  const numberField = (
    index: number,
    label: string,
    value: number,
    key: 'calories' | 'protein' | 'carbs' | 'fat'
  ) => (
    <div className="flex-1 min-w-0">
      <label className="block text-caption text-ink-3 mb-0.5">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => updateItem(index, { [key]: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
        className="w-full px-2 py-1 bg-card rounded-lg text-subhead text-ink focus:outline-none focus:ring-1 focus:ring-action shadow-card"
      />
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Describe a meal" size="lg">
      <div className="space-y-4">
        {/* Meal selector chips */}
        <div className="flex gap-2 flex-wrap">
          {MEAL_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => setMealType(option.type)}
              className={`rounded-full px-2.5 py-1 text-caption transition-colors ${
                mealType === option.type
                  ? 'bg-action text-on-action'
                  : 'bg-fill text-ink-2 hover:bg-sep'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {items === null ? (
          <>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder="2 eggs, toast with butter, and a glass of orange juice"
              className="w-full px-3 py-2 bg-card rounded-lg text-subhead text-ink placeholder-ink-3 resize-none focus:outline-none focus:ring-2 focus:ring-action shadow-card"
            />

            {parseError && (
              <p className="text-subhead text-status-bad">{parseError}</p>
            )}
            {showUpgrade && (
              <UpgradePrompt feature="aiFeatures" variant="inline" title="AI meal logging" />
            )}
            {onFreeAllowance && !showUpgrade && (
              <p className="text-caption text-ink-3">
                Free plan: {AI_DAILY_LIMITS.meal_parse.free} AI meal logs a day. Pro removes the limit.
              </p>
            )}

            <Button
              variant="primary"
              onClick={handleParse}
              disabled={isParsing || !description.trim()}
              className="w-full"
            >
              {isParsing ? 'Estimating macros...' : 'Estimate macros'}
            </Button>
          </>
        ) : (
          <>
            {/* Editable review list */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {items.map((item, index) => (
                <div key={index} className="rounded-lg bg-fill/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) => updateItem(index, { name: e.target.value })}
                      className="flex-1 text-subhead"
                      aria-label="Food name"
                    />
                    <Input
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      className="w-24 text-subhead"
                      aria-label="Quantity"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="p-1.5 text-ink-3 hover:text-status-bad transition-colors flex-shrink-0"
                      aria-label={`Remove ${item.name}`}
                    >
                      <IconTrash size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {numberField(index, 'kcal', item.calories, 'calories')}
                    {numberField(index, 'P (g)', item.protein, 'protein')}
                    {numberField(index, 'C (g)', item.carbs, 'carbs')}
                    {numberField(index, 'F (g)', item.fat, 'fat')}
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-center text-subhead text-ink-3 py-4">
                  All items removed — start over to try again.
                </p>
              )}
            </div>

            {logError && <p className="text-subhead text-status-bad">{logError}</p>}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setItems(null);
                  setLogError('');
                }}
                disabled={isLogging}
              >
                Start over
              </Button>
              <Button
                variant="primary"
                onClick={handleLog}
                disabled={isLogging || items.length === 0}
                className="flex-1"
              >
                {isLogging
                  ? 'Logging...'
                  : `Log ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

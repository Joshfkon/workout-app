'use client';

import { IconMessage, IconScan, IconSearch, IconBookmark, type Icon } from '@tabler/icons-react';

interface NutritionQuickActionsProps {
  onDescribe: () => void;
  onScan: () => void;
  onSearch: () => void;
  onMeals: () => void;
}

function QuickAction({
  label,
  icon: ActionIcon,
  onClick,
  accent = false,
}: {
  label: string;
  icon: Icon;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] transition-colors ${
        accent
          ? 'border-primary-500/40 bg-primary-500/10 text-primary-400 hover:bg-primary-500/20'
          : 'border-surface-800 bg-surface-900 text-surface-300 hover:bg-surface-800'
      }`}
    >
      <ActionIcon size={18} aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Phase 4.2 quick-actions row: Describe (AI parse), Scan (barcode),
 * Search (unified food search), Meals (saved meals).
 */
export function NutritionQuickActions({ onDescribe, onScan, onSearch, onMeals }: NutritionQuickActionsProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <QuickAction label="Describe" icon={IconMessage} onClick={onDescribe} accent />
      <QuickAction label="Scan" icon={IconScan} onClick={onScan} />
      <QuickAction label="Search" icon={IconSearch} onClick={onSearch} />
      <QuickAction label="Meals" icon={IconBookmark} onClick={onMeals} />
    </div>
  );
}

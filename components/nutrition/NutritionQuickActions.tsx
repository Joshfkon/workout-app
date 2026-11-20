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
      className="flex flex-col items-center gap-1.5 rounded-[14px] bg-card py-3 text-caption text-ink shadow-card transition-colors active:bg-fill"
      data-accent={accent ? 'true' : undefined}
    >
      <ActionIcon size={22} className="text-action" aria-hidden="true" />
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

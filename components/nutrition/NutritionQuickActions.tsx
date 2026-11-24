'use client';

import { IconMessage, IconScan, IconSearch, IconBookmark, type Icon } from '@tabler/icons-react';
import { NO_CAMERA_SCAN_TILE } from '@/lib/nutrition/cameraPrecheck';

interface NutritionQuickActionsProps {
  onDescribe: () => void;
  onScan: () => void;
  onSearch: () => void;
  onMeals: () => void;
  /**
   * The device has no camera (see useNoCamera): Scan says, before the tap,
   * that it will ask for the typed barcode number. False until checked after
   * mount, so the server and first client render match.
   */
  noCamera?: boolean;
}

function QuickAction({
  label,
  sublabel,
  icon: ActionIcon,
  onClick,
  accent = false,
  describedBy,
  testId,
}: {
  label: string;
  sublabel?: string;
  icon: Icon;
  onClick: () => void;
  accent?: boolean;
  describedBy?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-describedby={describedBy}
      className="flex flex-col items-center gap-1.5 rounded-[14px] bg-card py-3 text-caption text-ink shadow-card transition-colors active:bg-fill"
      data-accent={accent ? 'true' : undefined}
      data-testid={testId}
    >
      <ActionIcon size={22} className="text-action" aria-hidden="true" />
      <span className="flex flex-col items-center leading-tight">
        {label}
        {sublabel && <span className="whitespace-nowrap text-caption text-ink-3">{sublabel}</span>}
      </span>
    </button>
  );
}

/**
 * Phase 4.2 quick-actions row: Describe (AI parse), Scan (barcode),
 * Search (unified food search), Meals (saved meals).
 */
export function NutritionQuickActions({ onDescribe, onScan, onSearch, onMeals, noCamera = false }: NutritionQuickActionsProps) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        <QuickAction label="Describe" icon={IconMessage} onClick={onDescribe} accent />
        <QuickAction
          label="Scan"
          sublabel={noCamera ? 'type code' : undefined}
          icon={IconScan}
          onClick={onScan}
          describedBy={noCamera ? 'quick-action-no-camera' : undefined}
          testId="quick-action-scan"
        />
        <QuickAction label="Search" icon={IconSearch} onClick={onSearch} />
        <QuickAction label="Meals" icon={IconBookmark} onClick={onMeals} />
      </div>
      {noCamera && (
        <p id="quick-action-no-camera" className="mt-1.5 px-1 text-caption text-ink-2" data-testid="quick-action-no-camera">
          {NO_CAMERA_SCAN_TILE}
        </p>
      )}
    </div>
  );
}

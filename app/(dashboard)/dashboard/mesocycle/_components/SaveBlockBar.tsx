import { Button } from '@/components/ui';

/**
 * The review step's save action, pinned above the tab bar so it is on
 * screen however far the lifter scrolls (UX panel round 20: "I couldn't
 * confirm a final save or create button on the review step"). Says where
 * the block will live, shows a save failure right next to the button (the
 * page-top error is out of sight from here), and confirms the save.
 */
export function SaveBlockBar({
  onBack,
  onSave,
  isSaving,
  saved,
  error,
  blockName,
  isBuilding = false,
}: {
  onBack: () => void;
  onSave: () => void;
  isSaving: boolean;
  saved: boolean;
  error: string | null;
  blockName: string;
  /** The plan is still being generated: saving now would save the old one. */
  isBuilding?: boolean;
}) {
  return (
    <div
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-sep bg-card/95 px-4 pb-3 pt-3 backdrop-blur lg:bottom-4"
      data-testid="builder-save-bar"
    >
      {error && !saved && (
        <p className="mb-2 text-subhead text-status-bad" role="alert" data-testid="builder-save-error">
          Not saved: {error}
        </p>
      )}
      {saved ? (
        <p className="text-subhead font-semibold text-status-ok" role="status" data-testid="builder-saved">
          ✓ Saved &ldquo;{blockName}&rdquo;. Opening it now: it&apos;s your active plan, under Train → Plan.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onBack} disabled={isSaving}>
              Back
            </Button>
            <Button
              className="flex-1"
              size="lg"
              onClick={onSave}
              isLoading={isSaving}
              disabled={isBuilding}
              data-testid="builder-save"
            >
              {isBuilding ? 'Building your plan…' : 'Save training block'}
            </Button>
          </div>
          <p className="mt-1.5 text-caption text-ink-3">
            Becomes your active plan (replacing any current one). Find it under Train → Plan.
          </p>
        </>
      )}
    </div>
  );
}

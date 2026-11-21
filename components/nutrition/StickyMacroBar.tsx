'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { DailyNutritionSummary, MacroVerdict } from '@/hooks/useDailyNutritionSummary';

interface StickyMacroBarProps {
  summary: DailyNutritionSummary;
  /** The hero MacroSummaryCard wrapper — the bar shows once this scrolls out of view */
  watchRef: RefObject<HTMLDivElement | null>;
}

function MacroChip({ letter, dotClass, verdict }: { letter: string; dotClass: string; verdict: MacroVerdict }) {
  if (verdict.state === 'none') return null;
  return (
    <span className="flex items-center gap-1 rounded-full border border-sep bg-card/80 px-2 py-0.5 text-caption tabular-nums">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {verdict.state === 'hit' ? (
        <span className="text-status-ok font-medium">{letter} ✓</span>
      ) : verdict.state === 'over' ? (
        <span className="text-status-bad font-medium">{letter} +{verdict.grams}g</span>
      ) : (
        <span className="text-ink">{letter} {verdict.grams}g</span>
      )}
    </span>
  );
}

/** Expanded-state row: same labeled progress bars as the hero card */
function MacroDetailRow({
  label,
  value,
  target,
  fillClass,
}: {
  label: string;
  value: number;
  target: number | null;
  fillClass: string;
}) {
  if (!target || target <= 0) return null;
  const pct = Math.min((value / target) * 100, 100);
  return (
    <div>
      <div className="text-caption text-ink-2 mb-1">
        {label} {Math.round(value)} / {target}g
      </div>
      <div className="h-[3px] bg-fill rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Condensed sticky remaining-macros bar for the Food Log tab. Hidden while
 * the hero MacroSummaryCard is on screen; once the hero scrolls out the bar
 * slides down from the top of the viewport (the app header scrolls away with
 * the page), keeping the remaining budget visible next to the Add Food
 * buttons. Tap to expand the full per-macro breakdown. Overlays the meal
 * list (fixed) — no layout shift.
 */
export function StickyMacroBar({ summary, watchRef }: StickyMacroBarProps) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = watchRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show only when the hero has left through the TOP (scrolled past it).
        // top < 0 also stays false when the tab is display:none (zeroed rect),
        // and on an empty short page where the hero never leaves the viewport.
        setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      // Count the hero as gone slightly early (~bar height) so the bar
      // slides in right as it covers the hero's last visible sliver
      { rootMargin: '-48px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [watchRef]);

  // Auto-collapse whenever the bar hides (user scrolled back to the hero)
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  if (!summary.hasTargets) return null;

  const { remainingCalories, overCalorieBudget, caloriePct, totals } = summary;

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 top-0 !mt-0 z-20 lg:left-64 border-b border-sep bg-canvas supports-[backdrop-filter]:bg-canvas/85 supports-[backdrop-filter]:backdrop-blur-lg transition-transform duration-[250ms] ease-out motion-reduce:transition-none ${
        visible ? 'translate-y-0' : '-translate-y-full pointer-events-none'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-label={
          overCalorieBudget
            ? `${Math.abs(remainingCalories)} calories over target. Tap for macro breakdown.`
            : `${remainingCalories} calories left. Tap for macro breakdown.`
        }
        tabIndex={visible ? 0 : -1}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {/* Collapsed row: remaining kcal left, macro verdict chips right */}
          <div className="flex h-11 items-center justify-between gap-3">
            {/* Spacer for the floating mobile menu button (same as the app header) */}
            <div className="w-10 flex-shrink-0 lg:hidden" aria-hidden="true" />
            <div className="flex items-baseline gap-1.5 min-w-0">
              {overCalorieBudget ? (
                <>
                  <span className="text-headline font-bold text-status-bad tabular-nums">
                    −{Math.abs(remainingCalories).toLocaleString()}
                  </span>
                  <span className="text-caption text-status-bad">over</span>
                </>
              ) : (
                <>
                  <span className="text-headline font-bold text-action tabular-nums">
                    {remainingCalories.toLocaleString()}
                  </span>
                  <span className="text-caption text-ink-2">kcal left</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <MacroChip letter="P" dotClass="bg-macro-protein" verdict={summary.protein} />
              <MacroChip letter="C" dotClass="bg-macro-carbs" verdict={summary.carbs} />
              <MacroChip letter="F" dotClass="bg-macro-fat" verdict={summary.fat} />
            </div>
          </div>

          {/* Expanded detail: full three-macro breakdown, same as the hero card */}
          <div
            className={`grid transition-[grid-template-rows] duration-[250ms] ease-out motion-reduce:transition-none ${
              expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              {/* pt-3 clears the floating mobile menu button (bottom edge ~56px) */}
              <div className="grid grid-cols-3 gap-2.5 pb-3 pt-3">
                <MacroDetailRow label="Protein" value={totals.protein} target={summary.targetGrams.protein} fillClass="bg-macro-protein" />
                <MacroDetailRow label="Carbs" value={totals.carbs} target={summary.targetGrams.carbs} fillClass="bg-macro-carbs" />
                <MacroDetailRow label="Fat" value={totals.fat} target={summary.targetGrams.fat} fillClass="bg-macro-fat" />
              </div>
            </div>
          </div>
        </div>

        {/* 4px calorie progress bar along the bottom edge */}
        <div className="h-1 bg-fill">
          <div
            className={`h-full ${overCalorieBudget ? 'bg-status-bad' : 'bg-action'}`}
            style={{ width: `${caloriePct}%` }}
          />
        </div>
      </button>
    </div>
  );
}

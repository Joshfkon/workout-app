'use client';

/**
 * Presentational sections for /dashboard/log. All state and data fetching
 * stay in the page; these components render what they're given.
 */

import {
  IconBarbell,
  IconCheck,
  IconChevronRight,
  IconScale,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import {
  assessIntakePace,
  DEFAULT_EATING_WINDOW,
  type EatingWindow,
  type PaceMacro,
  type PaceTone,
  type PacingPhase,
} from '@/services/intakePacing';

/** Uppercase micro-label above each section ("QUICK LOG", "TODAY SO FAR"). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-caption font-semibold text-ink-3">
      {children}
    </p>
  );
}

/** "today" / "yesterday" / weekday within a week / "Jun 28" beyond. */
export function formatRelativeDay(date: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// Unfinished workout banner
// ============================================================

interface UnfinishedWorkoutBannerProps {
  /** e.g. "4:03 PM"; null hides the "Started ..." prefix. */
  startedAtLabel: string | null;
  setsDone: number;
  onResume: () => void;
  onDiscard: () => void;
}

export function UnfinishedWorkoutBanner({
  startedAtLabel,
  setsDone,
  onResume,
  onDiscard,
}: UnfinishedWorkoutBannerProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-status-warn/10 border border-status-warn/30">
      <IconBarbell size={18} className="text-status-warn flex-shrink-0" aria-hidden="true" />
      <button
        onClick={onResume}
        className="flex-1 min-w-0 flex items-center gap-3 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-subhead font-semibold text-ink">
            Unfinished workout
          </span>
          <span className="block text-caption text-ink-2 truncate">
            {startedAtLabel ? `Started ${startedAtLabel} · ` : ''}
            {setsDone === 0
              ? 'no sets logged'
              : `${setsDone} ${setsDone === 1 ? 'set' : 'sets'} logged`}
          </span>
        </span>
        <span className="text-subhead font-semibold text-status-warn flex-shrink-0">Resume</span>
      </button>
      <button
        onClick={onDiscard}
        className="p-1.5 -m-1 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-fill/60 transition-colors flex-shrink-0"
        aria-label="Discard unfinished workout"
      >
        <IconX size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

// ============================================================
// Hero card (training day / rest day / no plan)
// ============================================================

const HERO_CTA_CLASS =
  'flex-1 py-3 rounded-xl bg-action text-on-action text-body font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed';
const HERO_SECONDARY_CTA_CLASS =
  'flex-1 py-3 rounded-xl bg-fill text-ink text-body font-semibold hover:bg-sep active:scale-[0.98] transition-all disabled:cursor-not-allowed';
const HERO_SPARKLE_CLASS =
  'w-12 self-stretch rounded-xl bg-card border border-sep flex items-center justify-center hover:bg-fill/70 active:scale-95 transition-all disabled:opacity-60';

interface LogHeroCardProps {
  /** Gradient (primary action) or muted (rest day) framing. */
  variant: 'primary' | 'muted';
  /** "Today · Mesocycle wk 3" eyebrow line. */
  eyebrow: string;
  /** "Chest & Back" / "Rest day" / "No training plan". */
  title: string;
  /** "7 exercises · est. 65 min · last done Thu" or the rest-day next line. */
  meta: string;
  ctaLabel: string;
  ctaDisabled?: boolean;
  onCtaTap: () => void;
  /** Opens the AI suggested workout sheet. */
  onSparkleTap: () => void;
  /** Sparkle-prefixed footnote under the buttons. */
  footnote: string;
}

export function LogHeroCard({
  variant,
  eyebrow,
  title,
  meta,
  ctaLabel,
  ctaDisabled,
  onCtaTap,
  onSparkleTap,
  footnote,
}: LogHeroCardProps) {
  return (
    <div
      className={
        variant === 'primary'
          ? 'rounded-card p-4 bg-action-tint'
          : 'rounded-card p-4 bg-card shadow-card'
      }
    >
      <p
        className={`text-caption font-semibold ${
          variant === 'primary' ? 'text-action' : 'text-ink-3'
        }`}
      >
        {eyebrow}
      </p>
      <h2 className="text-title font-bold text-ink mt-1.5">{title}</h2>
      <p className="text-subhead text-ink-2 mt-1">{meta}</p>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCtaTap}
          disabled={ctaDisabled}
          className={variant === 'primary' ? HERO_CTA_CLASS : HERO_SECONDARY_CTA_CLASS}
        >
          {ctaLabel}
        </button>
        <button onClick={onSparkleTap} className={HERO_SPARKLE_CLASS} aria-label="AI suggested workout">
          <IconSparkles size={20} className="text-action" aria-hidden="true" />
        </button>
      </div>
      <p className="flex items-center justify-center gap-1 text-caption text-ink-3 mt-2.5">
        <IconSparkles size={12} className="flex-shrink-0" aria-hidden="true" />
        {footnote}
      </p>
    </div>
  );
}

// ============================================================
// Quick log row
// ============================================================

interface QuickLogRowProps {
  /** Icon badge, pre-styled by the caller (color varies per row). */
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onTap: () => void;
  disabled?: boolean;
}

export function QuickLogRow({ icon, title, subtitle, onTap, disabled }: QuickLogRowProps) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-3 rounded-card bg-card text-left hover:bg-fill/70 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-card"
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-body font-semibold text-ink">{title}</span>
        <span className="block text-caption text-ink-3">{subtitle}</span>
      </span>
      <IconChevronRight size={16} className="text-ink-3 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}

// ============================================================
// Weight quick-log row
// ============================================================

interface WeightQuickLogRowProps {
  /** Display-formatted weight already logged today ("176.6 lb"); null = none yet. */
  todayLabel: string | null;
  /** Most recent prior entry line ("Yesterday: 176.6 lb"); null = no history. */
  lastLabel: string | null;
  onTap: () => void;
}

/**
 * State-aware "Log weight" quick-log row. Before today's weigh-in it prompts
 * with the last known weight; once logged it shows the value with a checkmark
 * and taps through to edit (the sheet upserts the same weight_log day-row).
 */
export function WeightQuickLogRow({ todayLabel, lastLabel, onTap }: WeightQuickLogRowProps) {
  const logged = todayLabel !== null;
  return (
    <QuickLogRow
      icon={
        <span
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            logged ? 'bg-status-ok/15' : 'bg-action/15'
          }`}
        >
          {logged ? (
            <IconCheck size={22} className="text-status-ok" aria-hidden="true" />
          ) : (
            <IconScale size={22} className="text-action" aria-hidden="true" />
          )}
        </span>
      }
      title={logged ? `Weight logged · ${todayLabel}` : 'Log weight'}
      subtitle={
        logged
          ? "Tap to edit today's entry"
          : lastLabel
            ? `${lastLabel} · none today`
            : 'Daily weigh-ins sharpen your body-comp trend'
      }
      onTap={onTap}
    />
  );
}

// ============================================================
// "Today so far" strip
// ============================================================

export const STEP_GOAL = 10000;

/** "Today so far" strip: consumed vs targets, plus wearable steps. */
export interface TodaySoFar {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  caloriesTarget: number | null;
  proteinTarget: number | null;
  carbsTarget: number | null;
  fatTarget: number | null;
  /** null = no activity data for today (tile hidden). */
  steps: number | null;
}

/** Tile styling per pacing tone (bar fill + status word color). */
const TONE_STYLES: Record<PaceTone, { bar: string; status: string }> = {
  green: { bar: 'bg-status-ok', status: 'text-status-ok' },
  yellow: { bar: 'bg-status-warn', status: 'text-status-warn' },
  orange: { bar: 'bg-orange-500', status: 'text-orange-400' },
  neutral: { bar: 'bg-sep', status: 'text-ink-3' },
};

function StatTile({
  label,
  value,
  sub,
  onTap,
}: {
  label: string;
  value: string;
  sub: string;
  onTap?: () => void;
}) {
  const content = (
    <>
      <span className="block text-caption text-ink-3">{label}</span>
      <span className="block text-headline font-bold text-ink mt-0.5">{value}</span>
      <span className="block text-caption text-ink-3 mt-0.5">{sub}</span>
    </>
  );
  const tileClass = 'p-3 rounded-card bg-card text-left shadow-card';
  if (!onTap) return <div className={tileClass}>{content}</div>;
  return (
    <button onClick={onTap} className={`${tileClass} hover:bg-fill/70 transition-colors`}>
      {content}
    </button>
  );
}

/**
 * One macro tile: consumed of target, progress bar, and (when the pacing
 * engine has a judgment) a one-word status — the word carries the meaning,
 * the color just reinforces it.
 */
function MacroTile({
  label,
  macro,
  consumed,
  target,
  unit,
  phase,
  window,
  now,
  onTap,
}: {
  label: string;
  macro: PaceMacro;
  consumed: number;
  target: number | null;
  unit: 'kcal' | 'g';
  phase: PacingPhase;
  window: EatingWindow;
  now?: Date;
  onTap: () => void;
}) {
  const verdict = assessIntakePace({ macro, consumed, target, phase, now, window });
  const tone = TONE_STYLES[verdict.tone];
  const suffix = unit === 'g' ? 'g' : '';
  const pct =
    target && target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;

  return (
    <button
      onClick={onTap}
      className="p-3 rounded-card bg-card text-left hover:bg-fill/70 transition-colors shadow-card"
    >
      <span className="block text-caption text-ink-3">{label}</span>
      <span className="block text-headline font-bold text-ink mt-0.5">
        {consumed.toLocaleString()}
        {suffix}
        {target != null && target > 0 && (
          <span className="text-caption font-medium text-ink-3">
            {' '}
            of {Math.round(target).toLocaleString()}
            {suffix}
          </span>
        )}
      </span>
      {target != null && target > 0 && (
        <>
          <span className="block h-1 rounded-full bg-fill mt-2 overflow-hidden">
            <span
              className={`block h-full rounded-full ${tone.bar}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className={`block text-caption font-medium mt-1.5 ${tone.status}`}>
            {verdict.suppressed ? ' ' : verdict.status}
          </span>
        </>
      )}
    </button>
  );
}

export function TodaySoFarStrip({
  data,
  phase,
  eatingWindow = DEFAULT_EATING_WINDOW,
  now,
  onNutritionTap,
}: {
  data: TodaySoFar;
  /** Normalized training phase — flips which pacing direction warns. */
  phase: PacingPhase;
  eatingWindow?: EatingWindow;
  /** Injectable clock for tests; defaults to the current time. */
  now?: Date;
  onNutritionTap: () => void;
}) {
  const shared = { phase, window: eatingWindow, now, onTap: onNutritionTap };
  return (
    <div className="grid grid-cols-2 gap-2">
      <MacroTile
        label="Calories"
        macro="calories"
        consumed={data.calories}
        target={data.caloriesTarget}
        unit="kcal"
        {...shared}
      />
      <MacroTile
        label="Protein"
        macro="protein"
        consumed={data.protein}
        target={data.proteinTarget}
        unit="g"
        {...shared}
      />
      <MacroTile
        label="Carbs"
        macro="carbs"
        consumed={data.carbs}
        target={data.carbsTarget}
        unit="g"
        {...shared}
      />
      <MacroTile
        label="Fat"
        macro="fat"
        consumed={data.fat}
        target={data.fatTarget}
        unit="g"
        {...shared}
      />
      {data.steps != null && (
        <StatTile
          label="Steps"
          value={data.steps.toLocaleString()}
          sub={`of ${STEP_GOAL / 1000}k`}
        />
      )}
    </div>
  );
}

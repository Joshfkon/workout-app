'use client';

/**
 * Presentational sections for /dashboard/log. All state and data fetching
 * stay in the page; these components render what they're given.
 */

import {
  IconBarbell,
  IconChevronRight,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';

/** Uppercase micro-label above each section ("QUICK LOG", "TODAY SO FAR"). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-surface-500">
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
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-warning-500/10 border border-warning-500/30">
      <IconBarbell size={18} className="text-warning-400 flex-shrink-0" aria-hidden="true" />
      <button
        onClick={onResume}
        className="flex-1 min-w-0 flex items-center gap-3 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-surface-100">
            Unfinished workout
          </span>
          <span className="block text-[12px] text-surface-400 truncate">
            {startedAtLabel ? `Started ${startedAtLabel} · ` : ''}
            {setsDone === 0
              ? 'no sets logged'
              : `${setsDone} ${setsDone === 1 ? 'set' : 'sets'} logged`}
          </span>
        </span>
        <span className="text-[13px] font-semibold text-warning-400 flex-shrink-0">Resume</span>
      </button>
      <button
        onClick={onDiscard}
        className="p-1.5 -m-1 rounded-lg text-surface-500 hover:text-surface-300 hover:bg-surface-800/60 transition-colors flex-shrink-0"
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
  'flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-60';
const HERO_SECONDARY_CTA_CLASS =
  'flex-1 py-3 rounded-xl bg-surface-800 text-surface-200 text-[15px] font-semibold hover:bg-surface-700 transition-colors';
const HERO_SPARKLE_CLASS =
  'w-12 self-stretch rounded-xl bg-surface-900 border border-surface-800 flex items-center justify-center hover:bg-surface-800/70 transition-colors disabled:opacity-60';

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
          ? 'rounded-2xl p-4 border border-primary-500/20 bg-gradient-to-br from-primary-500/10 to-accent-500/10'
          : 'rounded-2xl p-4 bg-surface-900 border border-surface-800'
      }
    >
      <p
        className={`text-[11px] font-semibold tracking-[0.12em] uppercase ${
          variant === 'primary' ? 'text-primary-400' : 'text-surface-500'
        }`}
      >
        {eyebrow}
      </p>
      <h2 className="text-[26px] leading-tight font-bold text-surface-100 mt-1.5">{title}</h2>
      <p className="text-[13px] text-surface-400 mt-1">{meta}</p>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCtaTap}
          disabled={ctaDisabled}
          className={variant === 'primary' ? HERO_CTA_CLASS : HERO_SECONDARY_CTA_CLASS}
        >
          {ctaLabel}
        </button>
        <button onClick={onSparkleTap} className={HERO_SPARKLE_CLASS} aria-label="AI suggested workout">
          <IconSparkles size={20} className="text-primary-400" aria-hidden="true" />
        </button>
      </div>
      <p className="flex items-center justify-center gap-1 text-[11px] text-surface-500 mt-2.5">
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
      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors disabled:opacity-60"
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-surface-100">{title}</span>
        <span className="block text-[12px] text-surface-500">{subtitle}</span>
      </span>
      <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
    </button>
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
  caloriesTarget: number | null;
  proteinTarget: number | null;
  /** null = no activity data for today (tile hidden). */
  steps: number | null;
}

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
      <span className="block text-[12px] text-surface-500">{label}</span>
      <span className="block text-[17px] font-bold text-surface-100 mt-0.5">{value}</span>
      <span className="block text-[11px] text-surface-500 mt-0.5">{sub}</span>
    </>
  );
  const tileClass = 'p-3 rounded-2xl bg-surface-900 border border-surface-800 text-left';
  if (!onTap) return <div className={tileClass}>{content}</div>;
  return (
    <button onClick={onTap} className={`${tileClass} hover:bg-surface-800/70 transition-colors`}>
      {content}
    </button>
  );
}

export function TodaySoFarStrip({
  data,
  onNutritionTap,
}: {
  data: TodaySoFar;
  onNutritionTap: () => void;
}) {
  return (
    <div className={`grid gap-2 ${data.steps != null ? 'grid-cols-3' : 'grid-cols-2'}`}>
      <StatTile
        label="Calories"
        value={data.calories.toLocaleString()}
        sub={data.caloriesTarget ? `of ${data.caloriesTarget.toLocaleString()}` : ' '}
        onTap={onNutritionTap}
      />
      <StatTile
        label="Protein"
        value={`${data.protein.toLocaleString()}g`}
        sub={data.proteinTarget ? `of ${Math.round(data.proteinTarget)}g` : ' '}
        onTap={onNutritionTap}
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

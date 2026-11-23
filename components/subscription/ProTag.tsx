import type { Feature } from '@/lib/subscription';
import { cn } from '@/lib/utils';

/**
 * A small "Pro" (or "Elite") label for an entry point to a paid feature, so
 * people can tell what's paid before they tap. A label only: it never gates
 * anything (useSubscription().canAccess does that, unchanged) and shows the
 * same for everyone, trial and paid users included — it says which plan the
 * feature belongs to, not whether this user has it.
 *
 * Pass the gated `feature` (preferred: the plan is looked up in
 * FEATURE_PLAN, which a test keeps in line with lib/stripe TIER_FEATURES),
 * or a `tier` directly.
 *
 * Deliberately free of lib/stripe (server SDK) so any client component can
 * use it cheaply.
 */

export type PaidPlan = 'pro' | 'elite';

/**
 * The lowest paid plan that unlocks each gated feature — the same answer as
 * TIER_FEATURES[tier].limits[feature] (checked in ProTag.test). Only
 * features something actually gates belong here.
 */
export const FEATURE_PLAN: Partial<Record<Feature, PaidPlan>> = {
  mesocycleBuilder: 'pro',
  'ai-coaching': 'elite',
};

export const PLAN_LABEL: Record<PaidPlan, string> = { pro: 'Pro', elite: 'Elite' };

export interface ProTagProps {
  /** The gated feature this entry point opens. */
  feature?: Feature;
  /** The plan, when there's no single feature key. Ignored when `feature` maps to a plan. */
  tier?: PaidPlan;
  /** 'onAccent' for use inside a filled (primary) button. */
  tone?: 'default' | 'onAccent';
  className?: string;
}

export function ProTag({ feature, tier, tone = 'default', className }: ProTagProps) {
  const plan = (feature && FEATURE_PLAN[feature]) || tier || 'pro';
  return (
    <span
      data-testid="pro-tag"
      data-plan={plan}
      title={`Part of the ${PLAN_LABEL[plan]} plan`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide align-middle',
        tone === 'onAccent' ? 'bg-white/20 text-current' : 'bg-action-tint text-action',
        className
      )}
    >
      {PLAN_LABEL[plan]}
      <span className="sr-only"> plan</span>
    </span>
  );
}

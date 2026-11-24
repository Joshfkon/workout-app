/**
 * "Building your plan…" while the generator runs (UX panel round 21: "a
 * progress indicator while the plan builds"). The review's numbers below it
 * are the previous plan's until the new one lands, so this says they are
 * about to change. Renders nothing when idle.
 */
export function PlanBuildingIndicator({ active, className = '' }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <p
      className={`flex items-center gap-2 text-caption font-medium text-action ${className}`}
      role="status"
      aria-live="polite"
      data-testid="builder-plan-building"
    >
      <span
        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-action border-t-transparent"
        aria-hidden="true"
      />
      Building your plan…
    </p>
  );
}

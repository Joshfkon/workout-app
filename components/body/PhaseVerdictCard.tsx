'use client';

/**
 * Verdict card — the top element of the Body tab. Renders the rules-based
 * phase assessment (services/phaseAssessment): status accent, one-line
 * headline, compact detail rows, and the single suggestion when present.
 * Tapping it opens the phase editor.
 */

import Link from 'next/link';
import { Card } from '@/components/ui';
import type { Assessment } from '@/services/phaseAssessment';
import { STATUS_STYLE } from '@/components/body/phaseStyle';

interface PhaseVerdictCardProps {
  assessment: Assessment;
  /** Route of the phase editor / detail screen. */
  href: string;
}

export function PhaseVerdictCard({ assessment, href }: PhaseVerdictCardProps) {
  const style = STATUS_STYLE[assessment.status];

  return (
    <Link href={href} className="block" data-testid="phase-verdict-card">
      <Card
        className={`border-l-4 ${style.border} hover:bg-surface-800/60 transition-colors cursor-pointer`}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
            <span className="text-xs uppercase tracking-wide text-surface-400">{style.label}</span>
          </div>
          <p className="text-sm font-semibold text-surface-100">{assessment.headline}</p>
          {assessment.details.length > 0 && (
            <div className="space-y-1">
              {assessment.details.map((detail) => (
                <div key={`${detail.metric}-${detail.text}`} className="flex gap-2 text-xs">
                  <span className="text-surface-500 shrink-0 w-16">{detail.metric}</span>
                  <span className="text-surface-300">{detail.text}</span>
                </div>
              ))}
            </div>
          )}
          {assessment.suggestion && (
            <p className="text-xs text-surface-200 border-t border-surface-700/60 pt-2">
              {assessment.suggestion}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}

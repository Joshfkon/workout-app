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
      <Card className="transition-colors active:bg-fill cursor-pointer">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-headline text-ink">{assessment.headline}</p>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-fill px-2.5 py-1 text-caption font-semibold text-ink">
              <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
              {style.label}
            </span>
          </div>
          {assessment.details.length > 0 && (
            <div className="space-y-1">
              {assessment.details.map((detail) => (
                <div key={`${detail.metric}-${detail.text}`} className="flex gap-2 text-subhead">
                  <span className="text-ink-2 shrink-0 w-20">{detail.metric}</span>
                  <span className="text-ink">{detail.text}</span>
                </div>
              ))}
            </div>
          )}
          {assessment.suggestion && (
            <p className="text-subhead text-ink border-t border-sep pt-2">
              {assessment.suggestion}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}

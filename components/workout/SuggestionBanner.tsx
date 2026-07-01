'use client';

import { useState } from 'react';
import { IconSparkles, IconInfoCircle } from '@tabler/icons-react';
import { BottomSheet } from './BottomSheet';

interface SuggestionBannerProps {
  /** Suggested load, already formatted for display (e.g. "62.5 lbs", "BW +10 lbs"). */
  weightLabel: string;
  /** Suggested reps (or seconds), already formatted (e.g. "8", "30s"). */
  repsLabel: string;
  /** Target RIR shown to the user. */
  rir: number;
  /** One-sentence reason for the suggestion. */
  reason: string;
  /** Plain-language explanation lines for the info sheet. */
  explanation: string[];
}

/**
 * Tinted accent strip inside the exercise card showing the next-set
 * suggestion with its reasoning. The info icon opens a bottom sheet that
 * explains the math in plain language (trust-building surface).
 */
export function SuggestionBanner({
  weightLabel,
  repsLabel,
  rir,
  reason,
  explanation,
}: SuggestionBannerProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="flex items-start gap-2 rounded-lg bg-primary-500/10 px-3 py-2">
      <IconSparkles size={16} className="text-primary-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 text-[12px] leading-snug text-primary-400">
        <span className="font-medium">
          {weightLabel} × {repsLabel} @ {rir} RIR
        </span>
        {reason ? <span> — {reason}</span> : null}
      </p>
      <button
        onClick={() => setShowInfo(true)}
        className="flex-shrink-0 p-0.5 text-primary-400/70 hover:text-primary-300 transition-colors"
        aria-label="How this suggestion works"
      >
        <IconInfoCircle size={16} />
      </button>

      <BottomSheet
        isOpen={showInfo}
        onClose={() => setShowInfo(false)}
        title="How this suggestion works"
      >
        <ul className="space-y-2.5">
          {explanation.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-surface-300">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-primary-400 flex-shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

export default SuggestionBanner;

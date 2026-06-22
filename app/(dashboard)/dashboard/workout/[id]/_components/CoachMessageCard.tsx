'use client';

import { Card, LoadingAnimation } from '@/components/ui';
import type { generateCoachMessage } from '../_lib/coachMessage';

type CoachMessage = ReturnType<typeof generateCoachMessage>;

interface CoachMessageCardProps {
  coachMessage: CoachMessage | null;
  aiCoachNotesEnabled: boolean;
  showCoachMessage: boolean;
  onToggle: () => void;
  isLoadingAiNotes: boolean;
  aiCoachNotes: string | null;
}

export function CoachMessageCard({
  coachMessage,
  aiCoachNotesEnabled,
  showCoachMessage,
  onToggle,
  isLoadingAiNotes,
  aiCoachNotes,
}: CoachMessageCardProps) {
  if (!coachMessage || !aiCoachNotesEnabled) return null;

  return (
    <Card className="overflow-hidden border-primary-500/20 bg-gradient-to-br from-primary-500/5 to-surface-900">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">🏋️</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-surface-100">Coach&apos;s Notes</p>
          <p className="text-sm text-surface-400 truncate">
            {showCoachMessage ? 'Tap to collapse' : coachMessage.greeting}
          </p>
        </div>
        <svg
          className={`w-5 h-5 text-surface-400 transition-transform ${showCoachMessage ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showCoachMessage && (
        <div className="px-4 pb-4 space-y-4">
          {/* Greeting & Overview */}
          <div className="pl-13 space-y-2">
            <p className="text-surface-200 font-medium">{coachMessage.greeting}</p>
            <p className="text-sm text-surface-400">{coachMessage.overview}</p>
          </div>

          {/* AI-Powered Coach Notes - only show if enabled */}
          {aiCoachNotesEnabled && (
            <>
              {isLoadingAiNotes ? (
                <div className="ml-13 p-3 rounded-lg bg-surface-800 border border-surface-700">
                  <div className="flex items-center gap-3">
                    <LoadingAnimation type="dots" size="sm" />
                    <p className="text-sm text-surface-400">Your coach is reviewing your session...</p>
                  </div>
                </div>
              ) : aiCoachNotes ? (
                <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                  <div className="flex items-start gap-2">
                    <span className="text-primary-400 text-lg mt-0.5">💬</span>
                    <p className="text-sm text-primary-300 leading-relaxed">
                      {aiCoachNotes}
                    </p>
                  </div>
                </div>
              ) : coachMessage.personalizedInsight && (
                <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                  <p className="text-sm text-primary-300">
                    {coachMessage.personalizedInsight}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Tips */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider pl-13">
              Pro Tips
            </p>
            <div className="pl-13 space-y-1">
              {coachMessage.tips.map((tip, idx) => (
                <p key={idx} className="text-xs text-surface-400 flex gap-2">
                  <span className="text-primary-400">•</span>
                  {tip}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

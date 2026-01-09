'use client';

import { useMemo, useState, memo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { useMuscleRecovery, type MuscleRecoveryStatus } from '@/hooks/useMuscleRecovery';

interface RecoveryBarProps {
  status: MuscleRecoveryStatus;
  compact?: boolean;
}

function RecoveryBar({ status, compact = false }: RecoveryBarProps) {
  const { displayName, recoveryPercent, isReady, statusText, hoursRemaining } = status;

  // Color based on recovery status
  const barColor = useMemo(() => {
    if (isReady) return 'bg-success-500';
    if (recoveryPercent >= 75) return 'bg-success-400';
    if (recoveryPercent >= 50) return 'bg-warning-500';
    if (recoveryPercent >= 25) return 'bg-orange-500';
    return 'bg-danger-500';
  }, [isReady, recoveryPercent]);

  const statusColor = useMemo(() => {
    if (isReady) return 'text-success-400';
    if (recoveryPercent >= 75) return 'text-success-300';
    if (recoveryPercent >= 50) return 'text-warning-400';
    return 'text-danger-400';
  }, [isReady, recoveryPercent]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-24 text-xs text-surface-300 truncate">{displayName}</div>
        <div className="flex-1 h-1.5 bg-surface-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all duration-300`}
            style={{ width: `${recoveryPercent}%` }}
          />
        </div>
        <div className={`text-xs font-medium w-12 text-right ${statusColor}`}>
          {statusText}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-surface-300">{displayName}</span>
        <span className={`font-medium ${statusColor}`}>
          {statusText}
          {!isReady && hoursRemaining > 0 && (
            <span className="text-xs text-surface-500 ml-1">
              ({recoveryPercent}%)
            </span>
          )}
        </span>
      </div>
      <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${recoveryPercent}%` }}
        />
      </div>
    </div>
  );
}

interface MuscleRecoveryCardProps {
  /** Maximum muscles to show in collapsed view */
  limit?: number;
  /** Show only recovering muscles (hide ready ones) */
  showOnlyRecovering?: boolean;
  /** Compact display mode */
  compact?: boolean;
}

export const MuscleRecoveryCard = memo(function MuscleRecoveryCard({
  limit = 6,
  showOnlyRecovering = false,
  compact = false,
}: MuscleRecoveryCardProps) {
  const { recoveryStatus, recoveringMuscles, readyMuscles, isLoading, error, refresh } = useMuscleRecovery();
  const [showAll, setShowAll] = useState(false);

  // Determine which muscles to display
  const displayMuscles = useMemo(() => {
    if (showOnlyRecovering) {
      return showAll ? recoveringMuscles : recoveringMuscles.slice(0, limit);
    }

    // Sort: recovering muscles first (sorted by hours remaining), then ready muscles
    const sorted = [
      ...recoveringMuscles,
      ...readyMuscles,
    ];

    return showAll ? sorted : sorted.slice(0, limit);
  }, [recoveringMuscles, readyMuscles, showOnlyRecovering, showAll, limit]);

  const hasMore = showOnlyRecovering
    ? recoveringMuscles.length > limit
    : recoveryStatus.length > limit;

  // Summary stats
  const summary = useMemo(() => {
    const recovering = recoveringMuscles.length;
    const ready = readyMuscles.length;
    const avgRecoveryPercent = recoveryStatus.length > 0
      ? Math.round(recoveryStatus.reduce((sum, m) => sum + m.recoveryPercent, 0) / recoveryStatus.length)
      : 100;
    return { recovering, ready, avgRecoveryPercent };
  }, [recoveringMuscles, readyMuscles, recoveryStatus]);

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-surface-800 rounded w-1/3" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="space-y-2">
                <div className="h-4 bg-surface-800 rounded w-1/2" />
                <div className="h-2 bg-surface-800 rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-5">
        <div className="text-center py-4">
          <p className="text-danger-400 text-sm mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh}>Retry</Button>
        </div>
      </Card>
    );
  }

  // If no muscles are recovering and we only want to show recovering ones
  if (showOnlyRecovering && recoveringMuscles.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span className="text-lg">
              {summary.recovering > 0 ? '\u23F1\uFE0F' : '\u2705'}
            </span>
            <span>Muscle Recovery</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {summary.recovering > 0 ? (
              <span className="text-xs text-surface-500">
                {summary.recovering} recovering
              </span>
            ) : (
              <span className="text-xs text-success-400">
                All ready!
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {/* Recovery Summary */}
        {recoveringMuscles.length > 0 && (
          <div className="mb-4 p-3 bg-surface-800/50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-400">Overall Recovery</span>
              <span className="font-medium text-surface-200">
                {summary.avgRecoveryPercent}%
              </span>
            </div>
            <div className="mt-2 h-2 bg-surface-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  summary.avgRecoveryPercent >= 80 ? 'bg-success-500' :
                  summary.avgRecoveryPercent >= 50 ? 'bg-warning-500' : 'bg-danger-500'
                }`}
                style={{ width: `${summary.avgRecoveryPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-surface-500">
              <span>{summary.ready} ready</span>
              <span>{summary.recovering} recovering</span>
            </div>
          </div>
        )}

        {/* Muscle List */}
        <div className={compact ? "space-y-2" : "space-y-3"}>
          {displayMuscles.map((status: MuscleRecoveryStatus) => (
            <RecoveryBar
              key={status.muscle}
              status={status}
              compact={compact}
            />
          ))}
        </div>

        {/* Show More/Less Toggle */}
        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-4 w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center justify-center gap-1"
          >
            {showAll ? (
              <>
                <span>Show Less</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </>
            ) : (
              <>
                <span>Show All ({showOnlyRecovering ? recoveringMuscles.length : recoveryStatus.length})</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </>
            )}
          </button>
        )}
      </CardContent>
    </Card>
  );
});

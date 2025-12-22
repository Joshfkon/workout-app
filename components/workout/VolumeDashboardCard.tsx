'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useAdaptiveVolume } from '@/hooks/useAdaptiveVolume';
import type { MuscleGroup } from '@/types/schema';

interface VolumeBarProps {
  muscle: MuscleGroup;
  currentSets: number;
  estimatedMRV: number;
  status: 'below_mev' | 'low' | 'optimal' | 'high' | 'at_limit';
}

function VolumeBar({ muscle, currentSets, estimatedMRV, status }: VolumeBarProps) {
  const percentage = Math.min(100, Math.round((currentSets / estimatedMRV) * 100));

  const barColor = useMemo(() => {
    switch (status) {
      case 'below_mev':
        return 'bg-danger-500/60';
      case 'low':
        return 'bg-surface-500';
      case 'optimal':
        return 'bg-success-500';
      case 'high':
        return 'bg-warning-500';
      case 'at_limit':
        return 'bg-danger-500';
    }
  }, [status]);

  const statusIcon = status === 'at_limit' ? ' \u26A0\uFE0F' : status === 'below_mev' ? ' \u2193' : '';

  // Capitalize first letter
  const displayName = muscle.charAt(0).toUpperCase() + muscle.slice(1);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-surface-300">{displayName}</span>
        <span className="text-surface-400">
          {currentSets}/{estimatedMRV} sets{statusIcon}
        </span>
      </div>
      <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface VolumeDashboardCardProps {
  /** Limit to specific muscle groups */
  muscles?: MuscleGroup[];
  /** Maximum muscles to show */
  limit?: number;
  /** Show "View Details" link */
  showLink?: boolean;
}

export function VolumeDashboardCard({
  muscles,
  limit = 5,
  showLink = true,
}: VolumeDashboardCardProps) {
  const { volumeSummary, fatigueAlerts, isLoading, volumeProfile } = useAdaptiveVolume();

  // Filter and sort muscles
  const displayMuscles = useMemo(() => {
    let filtered = volumeSummary;

    if (muscles && muscles.length > 0) {
      filtered = volumeSummary.filter(v => muscles.includes(v.muscle));
    }

    // Sort by percentage of MRV (highest first) to show most relevant
    return filtered
      .sort((a, b) => b.percentOfMRV - a.percentOfMRV)
      .slice(0, limit);
  }, [volumeSummary, muscles, limit]);

  // Get relevant fatigue alert
  const primaryAlert = useMemo(() => {
    if (fatigueAlerts.length === 0) return null;
    // Show the most severe alert
    const alertPriority = { alert: 0, warning: 1 };
    return fatigueAlerts.sort(
      (a, b) => alertPriority[a.severity] - alertPriority[b.severity]
    )[0];
  }, [fatigueAlerts]);

  // Calculate confidence description
  const confidenceDesc = useMemo(() => {
    if (!volumeProfile) return 'Establishing baseline';

    const dataPoints = Object.values(volumeProfile.muscleTolerance)
      .reduce((sum, t) => sum + t.dataPoints, 0);

    if (dataPoints === 0) return 'Using research defaults';
    if (dataPoints < 13) return 'Learning your recovery';
    if (dataPoints < 26) return 'Building confidence';
    return 'Personalized for you';
  }, [volumeProfile]);

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

  return (
    <Card className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{'\uD83D\uDCCA'}</span>
          <h3 className="font-semibold text-surface-100">Volume & Recovery</h3>
        </div>
        <span className="text-xs text-surface-500">{confidenceDesc}</span>
      </div>

      {/* Volume Bars */}
      <div className="space-y-3 mb-4">
        {displayMuscles.map(summary => (
          <VolumeBar
            key={summary.muscle}
            muscle={summary.muscle}
            currentSets={summary.currentSets}
            estimatedMRV={summary.estimatedMRV}
            status={summary.status}
          />
        ))}
      </div>

      {/* Fatigue Alert */}
      {primaryAlert && (
        <div
          className={`p-3 rounded-lg mb-4 ${
            primaryAlert.severity === 'alert'
              ? 'bg-danger-500/10 border border-danger-500/20'
              : 'bg-warning-500/10 border border-warning-500/20'
          }`}
        >
          <p
            className={`text-sm font-medium ${
              primaryAlert.severity === 'alert' ? 'text-danger-300' : 'text-warning-300'
            }`}
          >
            {primaryAlert.severity === 'alert' ? '\u26A0\uFE0F' : '\u26A0'} {primaryAlert.message}
          </p>
        </div>
      )}

      {/* Link to Details */}
      {showLink && (
        <Link
          href="/dashboard/volume"
          className="flex items-center justify-between text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          <span>View Details</span>
          <span>{'\u2192'}</span>
        </Link>
      )}
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import type { FatigueAlert } from '@/src/lib/training/adaptive-volume';

interface FatigueAlertBannerProps {
  alert: FatigueAlert;
  onDismiss?: () => void;
  onReduceVolume?: () => void;
  onPlanDeload?: () => void;
}

export function FatigueAlertBanner({
  alert,
  onDismiss,
  onReduceVolume,
  onPlanDeload,
}: FatigueAlertBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const isAlert = alert.severity === 'alert';
  const bgColor = isAlert ? 'bg-status-bad/10' : 'bg-status-warn/10';
  const borderColor = isAlert ? 'border-status-bad/20' : 'border-status-warn/20';
  const textColor = isAlert ? 'text-status-bad' : 'text-status-warn';
  const icon = isAlert ? '\u26A0\uFE0F' : '\u26A0';

  // Capitalize muscle name
  const muscleName = alert.muscle.charAt(0).toUpperCase() + alert.muscle.slice(1);

  return (
    <Card className={`p-4 ${bgColor} border ${borderColor}`}>
      <div className="flex items-start gap-3">
        <span className="text-title shrink-0">{icon}</span>
        <div className="flex-1">
          <h4 className={`font-semibold ${textColor} mb-1`}>
            Fatigue Alert: {muscleName}
          </h4>
          <p className="text-body text-ink-2 mb-3">
            {alert.message}
          </p>
          <p className="text-body text-ink-2 mb-4">
            {alert.suggestion}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {onReduceVolume && (
              <button
                onClick={onReduceVolume}
                className={`px-3 py-1.5 text-subhead font-medium rounded-lg ${
                  isAlert
                    ? 'bg-status-bad hover:bg-status-bad text-white'
                    : 'bg-status-warn hover:bg-status-warn text-card'
                } transition-colors`}
              >
                Reduce volume
              </button>
            )}
            {onPlanDeload && (
              <button
                onClick={onPlanDeload}
                className="px-3 py-1.5 text-body font-medium rounded-lg bg-sep hover:bg-sep text-ink transition-colors"
              >
                Plan deload
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 text-body font-medium rounded-lg text-ink-2 hover:text-ink transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface FatigueAlertListProps {
  alerts: FatigueAlert[];
  onDismissAll?: () => void;
}

export function FatigueAlertList({ alerts, onDismissAll }: FatigueAlertListProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleAlerts = alerts.filter(
    alert => !dismissedIds.has(`${alert.muscle}-${alert.type}`)
  );

  if (visibleAlerts.length === 0) return null;

  const handleDismiss = (alert: FatigueAlert) => {
    setDismissedIds(prev => new Set(prev).add(`${alert.muscle}-${alert.type}`));
  };

  return (
    <div className="space-y-3">
      {visibleAlerts.map((alert, idx) => (
        <FatigueAlertBanner
          key={`${alert.muscle}-${alert.type}-${idx}`}
          alert={alert}
          onDismiss={() => handleDismiss(alert)}
        />
      ))}
      {visibleAlerts.length > 1 && onDismissAll && (
        <button
          onClick={() => {
            alerts.forEach(handleDismiss);
            onDismissAll();
          }}
          className="text-caption text-ink-3 hover:text-ink-2 transition-colors"
        >
          Dismiss all alerts
        </button>
      )}
    </div>
  );
}

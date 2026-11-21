'use client';

import { Badge } from '@/components/ui';
import { IconArrowsHorizontal, IconArrowsVertical, IconRefresh, IconScale } from '@tabler/icons-react';
import { type StrengthImbalance } from '@/services/coachingEngine';

interface ImbalanceAlertProps {
  imbalance: StrengthImbalance;
  compact?: boolean;
  className?: string;
}

export function ImbalanceAlert({ 
  imbalance, 
  compact = false,
  className = ''
}: ImbalanceAlertProps) {
  const severityColors = {
    minor: 'bg-fill/50',
    moderate: 'bg-status-warn-tint',
    significant: 'bg-status-bad-tint'
  };
  
  const severityBadge = {
    minor: 'default' as const,
    moderate: 'warning' as const,
    significant: 'danger' as const
  };
  
  const TypeIcon = {
    push_pull: IconArrowsHorizontal,
    upper_lower: IconArrowsVertical,
    anterior_posterior: IconRefresh,
    bilateral: IconScale,
  }[imbalance.type];
  
  if (compact) {
    return (
      <div className={`flex items-center gap-2 p-2 rounded-card ${severityColors[imbalance.severity]} ${className}`}>
        <TypeIcon className="h-4 w-4 flex-shrink-0 text-ink-2" stroke={1.75} aria-hidden="true" />
        <span className="text-subhead text-ink-2 flex-1 truncate">{imbalance.description}</span>
        <Badge size="sm" variant={severityBadge[imbalance.severity]}>
          {imbalance.severity}
        </Badge>
      </div>
    );
  }
  
  return (
    <div className={`p-4 rounded-card ${severityColors[imbalance.severity]} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-3">
          <TypeIcon className="h-5 w-5 flex-shrink-0 text-ink-2 mt-0.5" stroke={1.75} aria-hidden="true" />
          <div>
            <p className="font-medium text-ink">{imbalance.description}</p>
            <p className="text-subhead text-ink-2 mt-1">{imbalance.recommendation}</p>
          </div>
        </div>
        <Badge variant={severityBadge[imbalance.severity]}>
          {imbalance.severity}
        </Badge>
      </div>
    </div>
  );
}

// List of imbalances
interface ImbalanceListProps {
  imbalances: StrengthImbalance[];
  compact?: boolean;
  className?: string;
}

export function ImbalanceList({ 
  imbalances, 
  compact = false,
  className = ''
}: ImbalanceListProps) {
  if (imbalances.length === 0) {
    return (
      <div className={`p-4 bg-status-ok/10 border border-status-ok/30 rounded-lg text-center ${className}`}>
        <span className="text-status-ok">✓ No significant imbalances detected</span>
      </div>
    );
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      {imbalances.map((imbalance, i) => (
        <ImbalanceAlert 
          key={i} 
          imbalance={imbalance} 
          compact={compact}
        />
      ))}
    </div>
  );
}


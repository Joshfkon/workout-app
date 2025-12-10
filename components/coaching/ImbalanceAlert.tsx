'use client';

import { Badge } from '@/components/ui';
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
    minor: 'bg-surface-800/50',
    moderate: 'bg-warning-500/10 border border-warning-500/30',
    significant: 'bg-danger-500/10 border border-danger-500/30'
  };
  
  const severityBadge = {
    minor: 'default' as const,
    moderate: 'warning' as const,
    significant: 'danger' as const
  };
  
  const typeIcons = {
    push_pull: '↔️',
    upper_lower: '↕️',
    anterior_posterior: '🔄',
    bilateral: '⚖️'
  };
  
  if (compact) {
    return (
      <div className={`flex items-center gap-2 p-2 rounded-lg ${severityColors[imbalance.severity]} ${className}`}>
        <span>{typeIcons[imbalance.type]}</span>
        <span className="text-sm text-surface-300 flex-1 truncate">{imbalance.description}</span>
        <Badge size="sm" variant={severityBadge[imbalance.severity]}>
          {imbalance.severity}
        </Badge>
      </div>
    );
  }
  
  return (
    <div className={`p-4 rounded-lg ${severityColors[imbalance.severity]} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-3">
          <span className="text-xl">{typeIcons[imbalance.type]}</span>
          <div>
            <p className="font-medium text-surface-200">{imbalance.description}</p>
            <p className="text-sm text-surface-400 mt-1">{imbalance.recommendation}</p>
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
      <div className={`p-4 bg-success-500/10 border border-success-500/30 rounded-lg text-center ${className}`}>
        <span className="text-success-400">✓ No significant imbalances detected</span>
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


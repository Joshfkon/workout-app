'use client';

import { Badge } from '@/components/ui';
import { 
  type StrengthLevel, 
  formatStrengthLevel, 
  getStrengthLevelBadgeVariant 
} from '@/services/coachingEngine';

interface StrengthLevelBadgeProps {
  level: StrengthLevel;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

export function StrengthLevelBadge({ 
  level, 
  size = 'md',
  showIcon = false,
  className = ''
}: StrengthLevelBadgeProps) {
  const icons: Record<StrengthLevel, string> = {
    untrained: '🌱',
    beginner: '🌿',
    novice: '💪',
    intermediate: '🔥',
    advanced: '⭐',
    elite: '👑'
  };
  
  return (
    <Badge 
      variant={getStrengthLevelBadgeVariant(level)}
      size={size}
      className={className}
    >
      {showIcon && <span className="mr-1">{icons[level]}</span>}
      {formatStrengthLevel(level)}
    </Badge>
  );
}


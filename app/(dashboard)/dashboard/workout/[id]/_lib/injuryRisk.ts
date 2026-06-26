import type { Exercise } from '@/types/schema';
import {
  getInjuryRisk,
  INJURY_LABELS,
  type InjuryArea,
  type InjuryRisk,
} from '@/services/injuryAwareSwapper';

// Wrapper to convert injuries array to get risk info using new intelligent swapper
export function getExerciseInjuryRisk(
  exercise: Exercise,
  injuries: { area: string; severity: 1 | 2 | 3 }[]
): { isRisky: boolean; severity: number; reasons: string[]; risk: InjuryRisk } {
  if (injuries.length === 0) return { isRisky: false, severity: 0, reasons: [], risk: 'safe' };

  let worstRisk: InjuryRisk = 'safe';
  let maxSeverity = 0;
  const reasons: string[] = [];

  for (const injury of injuries) {
    const risk = getInjuryRisk(exercise, injury.area as InjuryArea);

    if (risk === 'avoid') {
      worstRisk = 'avoid';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`May aggravate ${INJURY_LABELS[injury.area] || injury.area}`);
    } else if (risk === 'caution' && worstRisk !== 'avoid') {
      worstRisk = 'caution';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`Use caution (${INJURY_LABELS[injury.area] || injury.area})`);
    }
  }

  return {
    isRisky: worstRisk !== 'safe',
    severity: maxSeverity,
    reasons: Array.from(new Set(reasons)),
    risk: worstRisk,
  };
}

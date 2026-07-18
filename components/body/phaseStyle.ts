/**
 * Shared visual vocabulary for training phases: one color per phase type,
 * used identically by the Body tab trend chart bands, the phase editor chart,
 * the phase banner, and the verdict card — a phase must look the same
 * everywhere it appears.
 */

import type { PhaseType } from '@/types/schema';
import type { AssessmentStatus } from '@/services/phaseAssessment';

export interface PhaseStyle {
  label: string;
  /** Hex used for chart band fills (rendered at low opacity). */
  band: string;
  /** Tailwind text color for badges/labels. */
  text: string;
  /** Tailwind background for badges (translucent). */
  badgeBg: string;
}

export const PHASE_STYLE: Record<PhaseType, PhaseStyle> = {
  bulk: {
    label: 'Bulk',
    band: '#22c55e',
    text: 'text-success-400',
    badgeBg: 'bg-success-500/15',
  },
  cut: {
    label: 'Cut',
    band: '#f97316',
    text: 'text-warning-400',
    badgeBg: 'bg-warning-500/15',
  },
  recomp: {
    label: 'Recomp',
    band: '#a855f7',
    text: 'text-accent-400',
    badgeBg: 'bg-accent-500/15',
  },
  maintenance: {
    label: 'Maintenance',
    band: '#71717a',
    text: 'text-surface-300',
    badgeBg: 'bg-surface-600/30',
  },
};

/** Opacity for phase ReferenceArea bands on charts. */
export const PHASE_BAND_OPACITY = 0.1;

/** Verdict card accent per assessment status. */
export const STATUS_STYLE: Record<
  AssessmentStatus,
  { border: string; dot: string; label: string }
> = {
  on_track: { border: 'border-l-success-500', dot: 'bg-success-500', label: 'On track' },
  attention: { border: 'border-l-warning-500', dot: 'bg-warning-500', label: 'Attention' },
  off_track: { border: 'border-l-danger-500', dot: 'bg-danger-500', label: 'Off track' },
  insufficient_data: {
    border: 'border-l-surface-600',
    dot: 'bg-surface-500',
    label: 'Not enough data',
  },
  no_phase: { border: 'border-l-surface-600', dot: 'bg-surface-500', label: 'No phase' },
};

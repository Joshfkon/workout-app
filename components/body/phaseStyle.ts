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
    text: 'text-status-ok',
    badgeBg: 'bg-status-ok/15',
  },
  cut: {
    label: 'Cut',
    band: '#f97316',
    text: 'text-status-warn',
    badgeBg: 'bg-status-warn/15',
  },
  recomp: {
    label: 'Recomp',
    band: '#a855f7',
    text: 'text-action',
    badgeBg: 'bg-action/15',
  },
  maintenance: {
    label: 'Maintenance',
    band: '#71717a',
    text: 'text-ink-2',
    badgeBg: 'bg-sep/30',
  },
};

/** Opacity for phase ReferenceArea bands on charts. */
export const PHASE_BAND_OPACITY = 0.1;

/** Verdict card accent per assessment status. */
export const STATUS_STYLE: Record<
  AssessmentStatus,
  { border: string; dot: string; label: string }
> = {
  on_track: { border: 'border-l-status-ok', dot: 'bg-status-ok', label: 'On track' },
  attention: { border: 'border-l-status-warn', dot: 'bg-status-warn', label: 'Attention' },
  off_track: { border: 'border-l-status-bad', dot: 'bg-status-bad', label: 'Off track' },
  insufficient_data: {
    border: 'border-l-sep',
    dot: 'bg-ink-3',
    label: 'Not enough data',
  },
  no_phase: { border: 'border-l-sep', dot: 'bg-ink-3', label: 'No phase' },
};

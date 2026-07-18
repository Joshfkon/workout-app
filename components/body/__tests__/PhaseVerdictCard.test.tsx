import { render, screen } from '@testing-library/react';
import { PhaseVerdictCard } from '@/components/body/PhaseVerdictCard';
import { PhaseBanner } from '@/components/body/PhaseBanner';
import { addLocalDays, localDay } from '@/lib/date/localDay';
import type { Assessment } from '@/services/phaseAssessment';
import type { TrainingPhase } from '@/types/schema';

describe('PhaseVerdictCard', () => {
  const assessment: Assessment = {
    status: 'attention',
    headline: 'Bulk, week 18: gaining faster than target',
    details: [
      { metric: 'Rate', text: 'Trend +1.5 lb/wk vs +0.5 target over 30d.' },
      { metric: 'Waist', text: 'Waist +0.6 in since Jul 15.' },
    ],
    suggestion: 'Reduce intake by 100-200 cal; the overshoot holds across both 14d and 30d windows.',
  };

  it('renders status, headline, detail rows, and the single suggestion', () => {
    render(<PhaseVerdictCard assessment={assessment} href="/dashboard/phases" />);
    expect(screen.getByTestId('phase-verdict-card')).toBeInTheDocument();
    expect(screen.getByText('Attention')).toBeInTheDocument();
    expect(screen.getByText('Bulk, week 18: gaining faster than target')).toBeInTheDocument();
    expect(screen.getByText('Trend +1.5 lb/wk vs +0.5 target over 30d.')).toBeInTheDocument();
    expect(screen.getByText(/Reduce intake by 100-200 cal/)).toBeInTheDocument();
    // Tapping opens the phase editor.
    expect(screen.getByTestId('phase-verdict-card')).toHaveAttribute('href', '/dashboard/phases');
  });

  it('renders the no-phase state without details', () => {
    render(
      <PhaseVerdictCard
        assessment={{ status: 'no_phase', headline: 'No active phase set. Set one to get phase-aware progress checks.', details: [] }}
        href="/dashboard/phases"
      />
    );
    expect(screen.getByText(/No active phase set/)).toBeInTheDocument();
  });
});

describe('PhaseBanner', () => {
  it('shows the set-one CTA without an active phase', () => {
    render(<PhaseBanner phase={null} href="/dashboard/phases" />);
    expect(screen.getByTestId('phase-banner-empty')).toHaveAttribute('href', '/dashboard/phases');
    expect(screen.getByText(/No active phase — set one/)).toBeInTheDocument();
  });

  it('shows type, week, start, and target with a Manage link', () => {
    const phase: TrainingPhase = {
      id: 'p1',
      userId: 'u1',
      phaseType: 'bulk',
      startDay: addLocalDays(localDay(), -125), // week 18
      endDay: null,
      targetRateLbsPerWeek: 0.5,
      note: null,
    };
    render(<PhaseBanner phase={phase} href="/dashboard/phases" />);
    expect(screen.getByTestId('phase-banner')).toBeInTheDocument();
    expect(screen.getByText('Bulk')).toBeInTheDocument();
    expect(screen.getByText(/week 18 · started/)).toBeInTheDocument();
    expect(screen.getByText(/target \+0\.5 lb\/wk/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/dashboard/phases');
  });
});

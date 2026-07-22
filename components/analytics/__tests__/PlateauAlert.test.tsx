/**
 * Tests for components/analytics/PlateauAlert.tsx
 * Unit-preference formatting (shared formatWeight path) and pluralization.
 */

import { render, screen } from '@testing-library/react';
import { PlateauAlert, PlateauAlertList } from '../PlateauAlert';
import type { PlateauDetectionResult } from '@/services/plateauDetector';

function makeResult(overrides: Partial<PlateauDetectionResult> = {}): PlateauDetectionResult {
  return {
    isPlateaued: true,
    weeksSinceProgress: 3,
    lastProgressDate: '2024-01-01',
    currentE1RM: 100,
    peakE1RM: 100,
    suggestions: ['Try a variation'],
    ...overrides,
  };
}

describe('PlateauAlert', () => {
  it('renders nothing when not plateaued', () => {
    const { container } = render(
      <PlateauAlert exerciseName="Bench Press" result={makeResult({ isPlateaued: false })} units="kg" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('formats the E1RM through the shared unit formatter (lb preference)', () => {
    // 100 kg -> 220.46 lb -> rounded to 2.5 lb increments = "220.0 lbs",
    // exactly what formatWeight produces for the trend cards.
    render(
      <PlateauAlert exerciseName="Arnold Press" result={makeResult({ currentE1RM: 100 })} units="lb" />
    );
    expect(screen.getByText('220.0 lbs')).toBeInTheDocument();
    expect(screen.queryByText(/100kg/)).not.toBeInTheDocument();
  });

  it('formats the E1RM in kg when that is the preference', () => {
    render(
      <PlateauAlert exerciseName="Arnold Press" result={makeResult({ currentE1RM: 100 })} units="kg" />
    );
    expect(screen.getByText('100.0 kg')).toBeInTheDocument();
  });

  it('shows the peak delta in the preferred unit without 2.5-increment rounding', () => {
    // current 98 kg vs peak 100 kg = -2 kg = -4.4 lb exact conversion.
    render(
      <PlateauAlert
        exerciseName="Arnold Press"
        result={makeResult({ currentE1RM: 98, peakE1RM: 100 })}
        units="lb"
      />
    );
    expect(screen.getByText(/-4\.4 lbs from peak/)).toBeInTheDocument();
  });

  it('pluralizes the stall duration correctly', () => {
    const { rerender } = render(
      <PlateauAlert exerciseName="Bench Press" result={makeResult({ weeksSinceProgress: 1 })} units="kg" />
    );
    expect(screen.getByText(/No progress in 1 week(?!s)/)).toBeInTheDocument();

    rerender(
      <PlateauAlert exerciseName="Bench Press" result={makeResult({ weeksSinceProgress: 4 })} units="kg" />
    );
    expect(screen.getByText(/No progress in 4 weeks/)).toBeInTheDocument();
  });

  it('hides the weight display (and warns) for a non-positive E1RM instead of rendering 0', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <PlateauAlert
        exerciseName="Bench Press"
        result={makeResult({ currentE1RM: 0, peakE1RM: 0 })}
        units="kg"
      />
    );
    expect(screen.queryByText(/Current E1RM/)).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid current E1RM'));
    warnSpy.mockRestore();
  });
});

describe('PlateauAlertList', () => {
  it('passes the unit preference through to every alert', () => {
    render(
      <PlateauAlertList
        units="lb"
        alerts={[
          { exerciseId: 'a', exerciseName: 'Arnold Press', result: makeResult({ currentE1RM: 100 }) },
          { exerciseId: 'b', exerciseName: 'Bench Press', result: makeResult({ currentE1RM: 50 }) },
        ]}
      />
    );
    expect(screen.getByText('220.0 lbs')).toBeInTheDocument();
    expect(screen.getByText('110.0 lbs')).toBeInTheDocument();
  });
});

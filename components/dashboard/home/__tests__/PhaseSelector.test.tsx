import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/lib/actions/phase', () => ({ updateTrainingPhase: jest.fn() }));
jest.mock('@/hooks/useTrainingPhases', () => ({ PHASES_QUERY_KEY_PREFIX: 'phases' }));
jest.mock('@/components/subscription/ProTag', () => ({ ProTag: () => null }));

import { PhaseSelector, phaseChipText } from '../PhaseSelector';

describe('PhaseSelector chip — plain words (UX round 20)', () => {
  it('says what each phase means next to its name', () => {
    expect(phaseChipText('cut')).toEqual({ label: 'Cutting', plain: 'losing fat' });
    expect(phaseChipText('maintenance')).toEqual({ label: 'Maintaining', plain: 'holding weight' });
    expect(phaseChipText('bulk')).toEqual({ label: 'Bulking', plain: 'gaining muscle' });
  });

  it('renders "Cutting · losing fat" on the chip', () => {
    render(<PhaseSelector phase="cut" onPhaseChanged={jest.fn()} />);
    const chip = screen.getByTestId('home-phase-chip');
    expect(chip).toHaveTextContent('Cutting · losing fat');
    expect(chip).toHaveAccessibleName('Current phase: Cutting (losing fat). Tap to change.');
  });
});

import { render, screen } from '@testing-library/react';
import { AboutTab } from '../AboutTab';
import type { Exercise } from '@/types/schema';

describe('AboutTab', () => {
  const baseExercise: Exercise = {
    id: 'test-exercise',
    name: 'ISO-Lateral Low Row',
    primaryMuscle: 'lats',
    secondaryMuscles: ['upper_back'],
    mechanic: 'compound',
    movementPattern: 'horizontal_pull',
    equipmentRequired: ['machine'],
    defaultRepRange: [8, 12],
    formCues: ['Keep chest up', 'Pull with elbows'],
    commonMistakes: ['Rounding back'],
    isBodyweight: false,
    isCustom: false,
    hypertrophyScore: {
      tier: 'A',
      stretchUnderLoad: 4,
      resistanceProfile: 4,
      progressionEase: 4,
    },
    createdAt: new Date().toISOString(),
  };

  it('renders muscle credits list with primary and secondary muscles', () => {
    render(<AboutTab exercise={baseExercise} sessionCount={0} />);
    
    const creditsList = screen.getByTestId('muscle-credits-list');
    expect(creditsList).toBeInTheDocument();
    expect(screen.getByText('Volume Credits Per Set')).toBeInTheDocument();
    
    // Primary muscle should show 1.0 credit
    expect(creditsList).toHaveTextContent('Lats');
    expect(creditsList).toHaveTextContent('Primary');
    expect(creditsList).toHaveTextContent('1.0');
    
    // Secondary muscle should show 0.5 credit
    expect(creditsList).toHaveTextContent('Upper Back');
    expect(creditsList).toHaveTextContent('0.5');
  });

  it('handles legacy coarse muscle tags with split credits', () => {
    const exerciseWithLegacy: Exercise = {
      ...baseExercise,
      primaryMuscle: 'chest',
      secondaryMuscles: ['triceps'],
    };
    
    render(<AboutTab exercise={exerciseWithLegacy} sessionCount={0} />);
    
    const creditsList = screen.getByTestId('muscle-credits-list');
    
    // Legacy 'chest' should split into chest_upper (0.5) and chest_lower (0.5)
    expect(creditsList).toHaveTextContent('Upper Chest');
    expect(creditsList).toHaveTextContent('Lower Chest');
    
    // Secondary triceps should also show
    expect(creditsList).toHaveTextContent('Triceps');
  });

  it('does not render credits list when no muscles are specified', () => {
    const noMusclesExercise: Exercise = {
      ...baseExercise,
      primaryMuscle: null,
      secondaryMuscles: [],
    };
    
    render(<AboutTab exercise={noMusclesExercise} sessionCount={0} />);
    
    expect(screen.queryByTestId('muscle-credits-list')).not.toBeInTheDocument();
  });

  it('handles multiple secondary muscles correctly', () => {
    const multiSecondary: Exercise = {
      ...baseExercise,
      primaryMuscle: 'quads',
      secondaryMuscles: ['glutes', 'hamstrings', 'calves'],
    };
    
    render(<AboutTab exercise={multiSecondary} sessionCount={0} />);
    
    const creditsList = screen.getByTestId('muscle-credits-list');
    
    // All muscles should appear in the credits list
    expect(creditsList).toHaveTextContent('Quads');
    expect(creditsList).toHaveTextContent('Glutes');
    expect(creditsList).toHaveTextContent('Hamstrings');
    expect(creditsList).toHaveTextContent('Calves');
    
    // Primary should have 1.0
    expect(creditsList).toHaveTextContent('1.0');
    
    // Each secondary should have 0.5
    const allCredits = creditsList.textContent || '';
    const halfCredits = (allCredits.match(/0\.5/g) || []).length;
    expect(halfCredits).toBeGreaterThanOrEqual(3);
  });

  it('renders anatomy map alongside credits list', () => {
    render(<AboutTab exercise={baseExercise} sessionCount={0} />);
    
    // Both anatomy map and credits list should be present
    expect(screen.getByTestId('exercise-muscle-map')).toBeInTheDocument();
    expect(screen.getByTestId('muscle-credits-list')).toBeInTheDocument();
  });

  it('shows rep range alongside muscles worked section', () => {
    render(<AboutTab exercise={baseExercise} sessionCount={0} />);
    
    expect(screen.getByText('Rep range')).toBeInTheDocument();
    expect(screen.getByText('8-12')).toBeInTheDocument();
  });
});

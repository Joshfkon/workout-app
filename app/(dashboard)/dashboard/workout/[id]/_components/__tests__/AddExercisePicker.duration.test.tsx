import { render, screen } from '@testing-library/react';
import { AddExercisePicker, type AddExercisePickerProps } from '../AddExercisePicker';
import type { AvailableExercise } from '../../_lib/types';

/**
 * The picker's duration readout: while browsing, the user should see what the
 * workout is about to cost them and what the current selection adds.
 */

const EXERCISES: AvailableExercise[] = [
  {
    id: 'bb-bench',
    name: 'Barbell Bench Press',
    primary_muscle: 'chest',
    mechanic: 'compound',
    equipment_required: ['barbell', 'bench'],
  },
];

function renderPicker(overrides: Partial<AddExercisePickerProps> = {}) {
  const props: AddExercisePickerProps = {
    variant: 'workout',
    availableExercises: EXERCISES,
    exerciseSearch: '',
    onExerciseSearchChange: jest.fn(),
    selectedMuscleFilter: null,
    onSelectedMuscleFilterChange: jest.fn(),
    selectedEquipmentGroups: [],
    onToggleEquipmentGroup: jest.fn(),
    exerciseSortOption: 'name',
    onExerciseSortOptionChange: jest.fn(),
    showAllExercises: true,
    onToggleShowAllExercises: jest.fn(),
    gymLocations: [],
    selectedLocationFilter: null,
    onSelectedLocationFilterChange: jest.fn(),
    unavailableEquipmentIds: [],
    unavailableExerciseIds: new Set(),
    stapleExerciseIds: new Set(),
    frequentExerciseIds: new Map(),
    lastDoneExercises: new Map(),
    selectedExercisesToAdd: [],
    onToggleExerciseSelection: jest.fn(),
    isAddingExercise: false,
    onClose: jest.fn(),
    onAddSelected: jest.fn(),
    ...overrides,
  };
  render(<AddExercisePicker {...props} />);
}

describe('AddExercisePicker duration readout', () => {
  it('shows the projected workout length', () => {
    renderPicker({ sessionDuration: { totalLabel: '55 min', deltaLabel: null } });
    expect(screen.getByTestId('picker-duration-estimate')).toHaveTextContent('~55 min workout');
  });

  it('shows what the pending selection adds', () => {
    renderPicker({ sessionDuration: { totalLabel: '1h 10m', deltaLabel: '+15 min' } });
    const readout = screen.getByTestId('picker-duration-estimate');
    expect(readout).toHaveTextContent('~1h 10m workout');
    expect(readout).toHaveTextContent('+15 min');
  });

  it('is absent on an empty workout with nothing to estimate', () => {
    renderPicker({ sessionDuration: null });
    expect(screen.queryByTestId('picker-duration-estimate')).not.toBeInTheDocument();
  });

  it('never displaces the modal title', () => {
    renderPicker({ sessionDuration: { totalLabel: '55 min', deltaLabel: '+10 min' } });
    expect(screen.getByRole('heading', { name: 'Add Exercise' })).toBeInTheDocument();
  });
});

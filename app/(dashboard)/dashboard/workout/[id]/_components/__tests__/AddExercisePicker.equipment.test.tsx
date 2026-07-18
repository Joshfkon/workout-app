import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddExercisePicker, type AddExercisePickerProps } from '../AddExercisePicker';
import type { AvailableExercise } from '../../_lib/types';

/**
 * Focused coverage for the equipment filter axis: it must render as its own
 * chip row and AND with the muscle filter, never replace it.
 */

const EXERCISES: AvailableExercise[] = [
  { id: 'bb-bench', name: 'Barbell Bench Press', primary_muscle: 'chest', mechanic: 'compound', equipment_required: ['barbell', 'bench'] },
  { id: 'db-press', name: 'Dumbbell Bench Press', primary_muscle: 'chest', mechanic: 'compound', equipment_required: ['dumbbells', 'bench'] },
  { id: 'pec-deck', name: 'Pec Deck', primary_muscle: 'chest', mechanic: 'isolation', equipment_required: ['pec deck machine'] },
  { id: 'bb-row', name: 'Barbell Row', primary_muscle: 'back', mechanic: 'compound', equipment_required: ['barbell'] },
  { id: 'db-curl', name: 'Dumbbell Curl', primary_muscle: 'biceps', mechanic: 'isolation', equipment_required: ['dumbbells'] },
];

function renderPicker(overrides: Partial<AddExercisePickerProps> = {}) {
  const onToggleEquipmentGroup = jest.fn();
  const onSelectedMuscleFilterChange = jest.fn();
  const props: AddExercisePickerProps = {
    variant: 'workout',
    availableExercises: EXERCISES,
    exerciseSearch: '',
    onExerciseSearchChange: jest.fn(),
    selectedMuscleFilter: null,
    onSelectedMuscleFilterChange,
    selectedEquipmentGroups: [],
    onToggleEquipmentGroup,
    exerciseSortOption: 'name',
    onExerciseSortOptionChange: jest.fn(),
    showAllExercises: true, // skip Recent/Suggested; render the full pool
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
  return { onToggleEquipmentGroup, onSelectedMuscleFilterChange };
}

const NAME_BY_ID = new Map(EXERCISES.map(e => [e.id, e.name]));
const rowNames = () =>
  screen
    .queryAllByTestId('add-exercise-row')
    .map(r => NAME_BY_ID.get(r.getAttribute('data-exercise-id') ?? '') ?? '');

describe('AddExercisePicker — equipment filter axis', () => {
  it('renders a distinct equipment chip row with the groups present in the library', () => {
    renderPicker();
    const row = screen.getByTestId('equipment-filter-row');
    expect(within(row).getByRole('button', { name: 'Barbell' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Dumbbell' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Machine' })).toBeInTheDocument();
    // No cable/smith/etc. in this library → not offered.
    expect(within(row).queryByRole('button', { name: 'Cable' })).not.toBeInTheDocument();
  });

  it('tapping an equipment chip reports the group (does not touch muscle state)', async () => {
    const user = userEvent.setup();
    const { onToggleEquipmentGroup, onSelectedMuscleFilterChange } = renderPicker();
    const row = screen.getByTestId('equipment-filter-row');
    await user.click(within(row).getByRole('button', { name: 'Barbell' }));
    expect(onToggleEquipmentGroup).toHaveBeenCalledWith('barbell');
    expect(onSelectedMuscleFilterChange).not.toHaveBeenCalled();
  });

  it('filters the list to the selected equipment group', () => {
    renderPicker({ selectedEquipmentGroups: ['barbell'] });
    const names = rowNames();
    expect(names).toEqual(expect.arrayContaining(['Barbell Bench Press', 'Barbell Row']));
    expect(names).not.toContain('Dumbbell Bench Press');
    expect(names).not.toContain('Pec Deck');
  });

  it('ANDs equipment with the muscle filter rather than replacing it', () => {
    // chest AND barbell → only the barbell chest press, not the barbell row.
    renderPicker({ selectedMuscleFilter: 'chest', selectedEquipmentGroups: ['barbell'] });
    const names = rowNames();
    expect(names).toEqual(['Barbell Bench Press']);
  });

  it('"Machine" group spans plate- and pin-loaded classes', () => {
    renderPicker({ selectedEquipmentGroups: ['machine'] });
    expect(rowNames()).toEqual(['Pec Deck']);
  });

  it('surfaces the equipment class on each result row', () => {
    renderPicker({ selectedMuscleFilter: 'biceps' });
    const row = screen.getByTestId('add-exercise-row');
    expect(within(row).getByText('Dumbbell')).toBeInTheDocument();
  });
});

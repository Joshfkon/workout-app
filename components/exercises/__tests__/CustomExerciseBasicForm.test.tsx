/**
 * Tests for the creation-time duplicate check in CustomExerciseBasicForm.
 * Typing a near-duplicate (even with a typo) surfaces existing exercises, and
 * "Use this instead" selects one without creating.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomExerciseBasicForm } from '../CustomExerciseBasicForm';

const EXERCISES = [
  { id: 'seated-1', name: 'Seated Calf Raise', primaryMuscle: 'calves', isCustom: false },
  { id: 'seated-2', name: 'Seated Calf Raise (Machine)', primaryMuscle: 'calves', isCustom: true },
  { id: 'bench-1', name: 'Barbell Bench Press', primaryMuscle: 'chest', isCustom: false },
];

jest.mock('@/services/exerciseService', () => ({
  getExercises: jest.fn(async () => EXERCISES),
}));

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: jest.fn(() => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order: jest.fn(async () => ({ data: [] })) })),
      })),
    })),
  })),
}));

describe('CustomExerciseBasicForm duplicate check', () => {
  it('surfaces existing exercises for a typo\'d name and selects one without creating', async () => {
    const user = userEvent.setup();
    const onUseExisting = jest.fn();
    const onSubmit = jest.fn();

    render(
      <CustomExerciseBasicForm
        onSubmit={onSubmit}
        onUseExisting={onUseExisting}
      />
    );

    const nameInput = await screen.findByLabelText(/exercise name/i);
    await user.type(nameInput, 'seated calf rase');

    const panel = await screen.findByTestId('dup-exercise-suggestions', {}, { timeout: 2000 });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Seated Calf Raise')).toBeInTheDocument();
    expect(screen.getByText('Seated Calf Raise (Machine)')).toBeInTheDocument();
    // Unrelated exercise is not suggested.
    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();

    const useButtons = screen.getAllByRole('button', { name: /use this instead/i });
    await user.click(useButtons[0]);

    expect(onUseExisting).toHaveBeenCalledTimes(1);
    expect(onUseExisting).toHaveBeenCalledWith(expect.any(String));
    // Selecting an existing exercise must not create a new one.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows no suggestions when no selection handler is wired', async () => {
    const user = userEvent.setup();
    render(<CustomExerciseBasicForm onSubmit={jest.fn()} />);

    const nameInput = await screen.findByLabelText(/exercise name/i);
    await user.type(nameInput, 'seated calf raise');

    // Give the debounce a chance; the panel must never appear.
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId('dup-exercise-suggestions')).not.toBeInTheDocument();
  });
});

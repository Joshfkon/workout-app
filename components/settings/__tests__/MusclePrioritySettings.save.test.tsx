/**
 * UX panel round 22 (Dre): "Save priorities button looks disabled and I can't
 * tell whether my priorities were saved." With nothing changed the button
 * says so in words; after a save it confirms; a failed save says so and
 * keeps the changes.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MusclePrioritySettings } from '../MusclePrioritySettings';

let upsertError: { message: string } | null = null;
const upsert = jest.fn(() => Promise.resolve({ error: upsertError }));

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      upsert,
    }),
  }),
}));

describe('MusclePrioritySettings save feedback', () => {
  beforeEach(() => {
    upsertError = null;
    upsert.mockClear();
  });

  it('says there is nothing to save, then enables Save on a change and confirms the save', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    render(<MusclePrioritySettings userId="u1" onSave={onSave} />);
    const save = await screen.findByTestId('save-priorities');
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent('No changes to save');

    await user.click(screen.getByRole('button', { name: 'Hamstrings: High priority' }));
    expect(save).toBeEnabled();
    expect(save).toHaveTextContent('Save priorities');
    expect(screen.getByTestId('priorities-save-status')).toHaveTextContent('unsaved changes');

    await user.click(save);
    expect(await screen.findByText('Priorities saved. Plans you build use them.')).toBeInTheDocument();
    expect(save).toHaveTextContent('Saved');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('says when a save fails and keeps the changes', async () => {
    upsertError = { message: 'offline' };
    const user = userEvent.setup();
    const onSave = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<MusclePrioritySettings userId="u1" onSave={onSave} />);
    await user.click(await screen.findByRole('button', { name: 'Hamstrings: High priority' }));
    await user.click(screen.getByTestId('save-priorities'));
    expect(await screen.findByText(/Couldn’t save your priorities/)).toBeInTheDocument();
    expect(screen.getByTestId('save-priorities')).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

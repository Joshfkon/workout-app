import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LocationPickerSheet,
  type LocationPickerScope,
  type PickerLocation,
} from '../LocationPickerSheet';

/**
 * The picker is the whole feature's surface: if it can't be reached and
 * understood mid-set, the calibration tracks underneath it never get used.
 * These tests hold the parts a user depends on — the inherit row that lets an
 * exercise fall back to the session, the honest count of already-logged sets
 * that will move, and inline creation for the machine that has no location yet.
 */

const LOCATIONS: PickerLocation[] = [
  { id: 'loc-main', name: 'Iron Works', is_default: true },
  { id: 'loc-annex', name: 'Annex', is_default: false },
];

function renderSheet(overrides: Partial<React.ComponentProps<typeof LocationPickerSheet>> = {}) {
  const props: React.ComponentProps<typeof LocationPickerSheet> = {
    isOpen: true,
    onClose: jest.fn(),
    scope: { kind: 'session' } as LocationPickerScope,
    locations: LOCATIONS,
    selectedId: 'loc-main',
    loggedSetCount: 0,
    onSelect: jest.fn(),
    onCreate: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  return { ...render(<LocationPickerSheet {...props} />), props };
}

describe('LocationPickerSheet — session scope', () => {
  it('lists the locations and marks the current one', () => {
    renderSheet();
    const options = screen.getAllByTestId('location-option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Iron Works');
    expect(options[1]).toHaveTextContent('Annex');
  });

  it('has no inherit row — a session has nothing to inherit from', () => {
    renderSheet();
    expect(screen.queryByTestId('location-option-inherit')).not.toBeInTheDocument();
  });

  it('reports how many logged sets will move', () => {
    renderSheet({ loggedSetCount: 3 });
    expect(screen.getByText(/3 sets already logged in this workout will move/i)).toBeInTheDocument();
  });

  it('says nothing about moving sets when none are logged yet', () => {
    renderSheet({ loggedSetCount: 0 });
    expect(screen.queryByText(/will move with it/i)).not.toBeInTheDocument();
  });

  it('hands the chosen location id back', async () => {
    const user = userEvent.setup();
    const { props } = renderSheet();

    await user.click(screen.getByText('Annex'));

    expect(props.onSelect).toHaveBeenCalledWith('loc-annex');
  });
});

describe('LocationPickerSheet — exercise scope', () => {
  const scope: LocationPickerScope = {
    kind: 'exercise',
    exerciseName: 'Hip Adduction Machine',
    sessionLocationName: 'Iron Works',
  };

  it('offers falling back to the workout location, naming it', () => {
    renderSheet({ scope, selectedId: null });
    const inherit = screen.getByTestId('location-option-inherit');
    expect(inherit).toHaveTextContent('Same as workout');
    expect(inherit).toHaveTextContent('Iron Works');
  });

  it('clears the pin with null, not a location id', async () => {
    const user = userEvent.setup();
    const { props } = renderSheet({ scope, selectedId: 'loc-annex' });

    await user.click(screen.getByTestId('location-option-inherit'));

    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it('explains the separation in terms of this exercise', () => {
    renderSheet({ scope, selectedId: null });
    expect(screen.getByText(/Hip Adduction Machine/)).toBeInTheDocument();
    expect(screen.getByText(/never average together/i)).toBeInTheDocument();
  });
});

describe('LocationPickerSheet — inline creation', () => {
  it('selects a newly created location immediately', async () => {
    const user = userEvent.setup();
    const created: PickerLocation = { id: 'loc-new', name: 'Hotel Gym' };
    const onCreate = jest.fn().mockResolvedValue(created);
    const { props } = renderSheet({ onCreate });

    await user.click(screen.getByTestId('location-add-trigger'));
    await user.type(screen.getByTestId('location-new-name'), 'Hotel Gym');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreate).toHaveBeenCalledWith('Hotel Gym');
    // Creating it and then making the user find it in the list would be two
    // taps for one intent.
    expect(props.onSelect).toHaveBeenCalledWith('loc-new');
  });

  it('surfaces a failed create instead of closing over it', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn().mockResolvedValue(null);
    const { props } = renderSheet({ onCreate });

    await user.click(screen.getByTestId('location-add-trigger'));
    await user.type(screen.getByTestId('location-new-name'), 'Hotel Gym');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Couldn't save that location/i)).toBeInTheDocument();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('will not create a blank-named location', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn();
    renderSheet({ onCreate });

    await user.click(screen.getByTestId('location-add-trigger'));
    await user.type(screen.getByTestId('location-new-name'), '   ');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

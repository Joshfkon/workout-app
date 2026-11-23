/** Toasts are announced: status for confirmations, alert for errors. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Toast } from '../Toast';

describe('Toast accessibility', () => {
  it('announces a confirmation politely, with a labelled close button', () => {
    render(<Toast id="1" type="success" message="Added Oatmeal (1 cup) to Lunch" onDismiss={jest.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Added Oatmeal (1 cup) to Lunch');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
  it('announces an error assertively', () => {
    render(<Toast id="2" type="error" message="Couldn't save" onDismiss={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save");
  });
});

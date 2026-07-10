/**
 * Component tests for ShareNutritionText — the Eat-tab share entry point.
 *
 * The repo's UI test harness is Jest + React Testing Library (jsdom); there
 * is no Playwright config or e2e scaffolding, and the nutrition page is gated
 * behind live Supabase auth, so these cover the spec's Playwright asks in the
 * infrastructure that actually runs in CI: the share icon renders, the
 * preview shows the formatted text, the no-numbers toggle strips numbers, and
 * the clipboard fallback fires when navigator.share is unavailable.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareNutritionText } from '../ShareNutritionText';
import { DEFAULT_EATING_WINDOW } from '@/services/intakePacing';

const baseProps = {
  totals: { calories: 3100, protein: 200, carbs: 380, fat: 85 },
  targets: { calories: 3100, protein: 200, carbs: 380, fat: 85 },
  phase: 'bulk' as const,
  phaseWeek: 1,
  mealsLogged: 4,
  eatingWindow: DEFAULT_EATING_WINDOW,
};

describe('ShareNutritionText', () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    writeText = jest.fn().mockResolvedValue(undefined);
    // navigator.clipboard is a getter-only prop in jsdom — redefine it.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    // Force the clipboard fallback path (no Web Share API in jsdom).
    delete (navigator as { share?: unknown }).share;
    localStorage.clear();
  });

  it('renders a share icon button', () => {
    render(<ShareNutritionText {...baseProps} />);
    expect(screen.getByRole('button', { name: /share nutrition as text/i })).toBeInTheDocument();
  });

  it('opens a preview showing the formatted share text', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));

    expect(screen.getByText(/HyperTrack 🍽️/)).toBeInTheDocument();
    expect(screen.getByText(/Protein 200 \/ 200g/)).toBeInTheDocument();
    expect(screen.getByText(/kcal/)).toBeInTheDocument();
  });

  it('no-numbers toggle strips every digit from the preview', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    expect(screen.getByText(/200 \/ 200g/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch'));

    // The preview <pre> now contains no digits at all.
    const preview = document.querySelector('pre');
    expect(preview?.textContent ?? '').not.toMatch(/\d/);
    expect(preview?.textContent ?? '').toContain('Protein');
  });

  it('persists the no-numbers choice to localStorage', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    await user.click(screen.getByRole('switch'));

    expect(localStorage.getItem('hypertrack:nutritionShareNoNumbers')).toBe('1');
  });

  it('copies to the clipboard when the Web Share API is unavailable', async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub for its
    // copy/paste API — reassert ours afterwards so we observe the real write.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    await user.click(screen.getByRole('button', { name: /Share 📋/ }));

    // The share action's fallback chain is async — wait for the button to
    // flip to the copied confirmation before asserting the clipboard write.
    expect(await screen.findByRole('button', { name: /Copied!/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('HyperTrack 🍽️');
  });
});

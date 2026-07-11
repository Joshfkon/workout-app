/**
 * Component tests for ShareNutritionText — the Eat-tab share entry point.
 *
 * The repo's UI test harness is Jest + React Testing Library (jsdom); there is
 * no Playwright config or e2e scaffolding, and the nutrition page is gated
 * behind live Supabase auth, so these cover the spec's Playwright asks in the
 * infrastructure that actually runs in CI: the mode selector renders and its
 * choice persists across a remount (the RTL analogue of "survives an app
 * restart"), the previewed text is exactly what the share action ships, the
 * no-numbers toggle strips numbers, and the clipboard fallback fires when
 * navigator.share is unavailable.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareNutritionText } from '../ShareNutritionText';
import { DEFAULT_EATING_WINDOW } from '@/services/intakePacing';

const baseProps = {
  totals: { calories: 2477, protein: 175, carbs: 280, fat: 74 },
  targets: { calories: 2558, protein: 155, carbs: 345, fat: 62 },
  phase: 'bulk' as const,
  phaseWeek: 1,
  mealsLogged: 4,
  eatingWindow: DEFAULT_EATING_WINDOW,
};

const preview = () => document.querySelector('[data-testid="nutrition-share-preview"]');

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
    expect(screen.getByText(/Protein 175\/155g/)).toBeInTheDocument();
    expect(screen.getByText(/kcal/)).toBeInTheDocument();
  });

  it('renders the three-way mode selector, defaulting to Full', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));

    expect(screen.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Minimal' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switching to Minimal rerenders the preview in that format', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    // Full mode shows the labelled macro grid.
    expect(preview()?.textContent ?? '').toContain('Protein 175/155g');

    await user.click(screen.getByRole('radio', { name: 'Minimal' }));

    const text = preview()?.textContent ?? '';
    expect(text).toContain('175g protein');
    expect(text).toContain('kcal · '); // minimal calorie line
    // Minimal deliberately omits carbs and fat entirely.
    expect(text).not.toContain('Carbs');
    expect(text).not.toContain('Fat');
  });

  it('persists the selected mode across a remount (app restart analogue)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(localStorage.getItem('hypertrack:nutritionShareMode')).toBe('compact');

    unmount();
    render(<ShareNutritionText {...baseProps} />);
    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));

    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
  });

  it('no-numbers toggle strips every digit from the preview', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    expect(screen.getByText(/175\/155g/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch'));

    // The preview now contains no digits at all.
    expect(preview()?.textContent ?? '').not.toMatch(/\d/);
    expect(preview()?.textContent ?? '').toContain('Protein');
  });

  it('persists the no-numbers choice to localStorage', async () => {
    const user = userEvent.setup();
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    await user.click(screen.getByRole('switch'));

    expect(localStorage.getItem('hypertrack:nutritionShareNoNumbers')).toBe('1');
  });

  it('shares exactly the previewed text (Minimal mode)', async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub for its
    // copy/paste API — reassert ours afterwards so we observe the real write.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ShareNutritionText {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /share nutrition as text/i }));
    await user.click(screen.getByRole('radio', { name: 'Minimal' }));

    const previewed = preview()?.textContent ?? '';
    await user.click(screen.getByRole('button', { name: /Share 📋/ }));

    // The share action's fallback chain is async — wait for the button to flip
    // to the copied confirmation before asserting the clipboard write.
    expect(await screen.findByRole('button', { name: /Copied!/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    // The clipboard payload matches the preview byte-for-byte.
    expect(writeText.mock.calls[0][0]).toBe(previewed);
    expect(writeText.mock.calls[0][0]).toContain('HyperTrack 🍽️');
  });
});

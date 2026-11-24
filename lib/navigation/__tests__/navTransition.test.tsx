/**
 * How dashboard screens enter: push slides in, tabs/back/launch don't.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { consumeNavTransition, resetNavTransitionForTests } from '../navTransition';

let mockPathname = '/dashboard';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Imported after the mock so the template picks it up.
// eslint-disable-next-line import/first
import DashboardTemplate from '@/app/(dashboard)/dashboard/template';

beforeEach(() => resetNavTransitionForTests());

describe('consumeNavTransition', () => {
  it('does not animate the first screen after launch', () => {
    expect(consumeNavTransition('/dashboard/workout/abc')).toBe('none');
  });

  it('slides in a pushed screen after the first', () => {
    consumeNavTransition('/dashboard');
    expect(consumeNavTransition('/dashboard/workout/abc')).toBe('push');
    expect(consumeNavTransition('/dashboard/history')).toBe('push');
  });

  it('keeps tab switches instant, with or without a trailing slash', () => {
    consumeNavTransition('/dashboard');
    expect(consumeNavTransition('/dashboard/nutrition')).toBe('none');
    expect(consumeNavTransition('/dashboard/analytics/')).toBe('none');
    expect(consumeNavTransition('/dashboard')).toBe('none');
  });

  it('keeps back navigation instant, then animates the next push again', () => {
    consumeNavTransition('/dashboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(consumeNavTransition('/dashboard/history')).toBe('none');
    expect(consumeNavTransition('/dashboard/workout/abc')).toBe('push');
  });
});

describe('DashboardTemplate', () => {
  it('never animates the first render after a full page load (server renders none: no hydration mismatch)', () => {
    consumeNavTransition('/dashboard'); // launch
    mockPathname = '/dashboard/workout/abc'; // would be a push on an SPA navigation
    const { unmount } = render(
      <DashboardTemplate>
        <p>First load</p>
      </DashboardTemplate>
    );
    expect(screen.getByText('First load').parentElement).toHaveAttribute('data-nav-transition', 'none');
    unmount();
  });

  it('wraps a pushed screen in the slide-in and clears it when the animation ends', () => {
    consumeNavTransition('/dashboard'); // launch
    mockPathname = '/dashboard/workout/abc';
    render(
      <DashboardTemplate>
        <p>Workout</p>
      </DashboardTemplate>
    );
    const wrapper = screen.getByText('Workout').parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute('data-nav-transition', 'push');
    expect(wrapper).toHaveClass('motion-safe:animate-push-in');

    fireEvent.animationEnd(wrapper);
    expect(wrapper).toHaveAttribute('data-nav-transition', 'none');
    expect(wrapper.className).toBe('');
    // Same element: the screen was not remounted.
    expect(screen.getByText('Workout').parentElement).toBe(wrapper);
  });

  it('renders a tab root with no animation', () => {
    consumeNavTransition('/dashboard/history');
    mockPathname = '/dashboard/nutrition';
    render(
      <DashboardTemplate>
        <p>Eat</p>
      </DashboardTemplate>
    );
    expect(screen.getByText('Eat').parentElement).toHaveAttribute('data-nav-transition', 'none');
  });
});

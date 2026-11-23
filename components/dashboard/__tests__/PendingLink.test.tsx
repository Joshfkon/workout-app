import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PendingLink } from '../PendingLink';
import { GlanceHeader } from '../home/GlanceHeader';

const mockPrefetch = jest.fn();
let mockPath = '/dashboard';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: mockPrefetch }),
  usePathname: () => mockPath,
}));
jest.mock('next/link', () => {
  // eslint-disable-next-line react/display-name
  return React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(
    ({ children, onClick, ...rest }, ref) => (
      <a
        ref={ref}
        {...rest}
        onClick={(e) => {
          onClick?.(e);
          e.preventDefault(); // jsdom: no real navigation
        }}
      >
        {children}
      </a>
    )
  );
});

beforeEach(() => {
  mockPrefetch.mockReset();
  mockPath = '/dashboard';
});

describe('PendingLink', () => {
  it('prefetches on pointer-down and shows a pending state from the tap', () => {
    render(
      <PendingLink href="/dashboard/settings" pendingClassName="is-pending" data-testid="link">
        {(pending) => (pending ? 'Loading' : 'Settings')}
      </PendingLink>
    );
    const link = screen.getByTestId('link');
    fireEvent.pointerDown(link);
    expect(mockPrefetch).toHaveBeenCalledWith('/dashboard/settings');
    expect(link).not.toHaveAttribute('aria-busy');
    fireEvent.click(link);
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(link).toHaveClass('is-pending');
    expect(link).toHaveTextContent('Loading');
  });

  it('is not pending when the link points at the current page', () => {
    mockPath = '/dashboard/settings';
    render(
      <PendingLink href="/dashboard/settings" data-testid="link">
        Settings
      </PendingLink>
    );
    fireEvent.click(screen.getByTestId('link'));
    expect(screen.getByTestId('link')).not.toHaveAttribute('aria-busy');
  });
});

describe('Home gear', () => {
  it('is a 44px target that acknowledges the first tap', () => {
    render(<GlanceHeader greeting="Good morning" todayLabel="Mon, Nov 23" />);
    const gear = screen.getByTestId('home-settings');
    expect(gear).toHaveClass('h-11', 'w-11');
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-busy', 'true');
  });
});

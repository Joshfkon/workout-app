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

  // UX panel round 19: personas re-tapped while the first navigation was
  // still loading; the repeat must not restart (or double) it.
  it('swallows a second tap while the first is still loading', () => {
    const onClick = jest.fn();
    render(
      <PendingLink href="/dashboard/settings" data-testid="link" onClick={onClick}>
        Settings
      </PendingLink>
    );
    const link = screen.getByTestId('link');
    expect(fireEvent.click(link)).toBe(false); // first tap: Link navigates (mock prevents in jsdom)
    expect(onClick).toHaveBeenCalledTimes(1);
    const second = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('aria-busy', 'true');
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
  it('is a labelled 48px target that acknowledges the first tap', () => {
    render(<GlanceHeader greeting="Good morning" todayLabel="Mon, Nov 23" />);
    const gear = screen.getByTestId('home-settings');
    // Visible word, not just an icon (round 20, Frank), and the link's name.
    expect(gear).toHaveTextContent('Settings');
    expect(screen.getByRole('link', { name: /^Settings/ })).toBe(gear);
    expect(gear).toHaveClass('min-h-12');
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-busy', 'true');
  });

  it('says it is opening Settings in words while the page loads', () => {
    render(<GlanceHeader greeting="Good morning" todayLabel="Mon, Nov 23" />);
    expect(screen.queryByTestId('home-settings-opening')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('home-settings'));
    const label = screen.getByTestId('home-settings-opening');
    expect(label).toHaveTextContent('Opening Settings…');
    expect(label).toHaveAttribute('role', 'status');
    // Absolutely placed: the header does not shift under the finger.
    expect(label).toHaveClass('absolute');
  });
});

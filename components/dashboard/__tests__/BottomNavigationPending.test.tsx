import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { BottomNavigation } from '../BottomNavigation';

let mockPathname = '/dashboard/train';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/hooks/useKeyboardOpen', () => ({ useKeyboardOpen: () => false }));
const mockHaptic = jest.fn();
jest.mock('@/lib/integrations/notifications', () => ({ lightHaptic: () => mockHaptic() }));
// Keep navigation inert: the test drives the pathname itself.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const tab = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) });

describe('BottomNavigation — instant feedback on tap', () => {
  beforeEach(() => {
    mockPathname = '/dashboard/train';
    mockHaptic.mockReset();
  });

  it('lights the tapped tab and shows the loading bar before the page arrives', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BottomNavigation />);
    expect(tab('Train')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('tab-nav-progress')).not.toBeInTheDocument();

    await user.click(tab('Home'));

    expect(tab('Home')).toHaveAttribute('aria-current', 'page');
    expect(tab('Train')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('tab-nav-progress')).toBeInTheDocument();

    // The page arrives: the bar goes and the real path drives the highlight.
    mockPathname = '/dashboard';
    rerender(<BottomNavigation />);
    expect(screen.queryByTestId('tab-nav-progress')).not.toBeInTheDocument();
    expect(tab('Home')).toHaveAttribute('aria-current', 'page');
  });

  it('shows no loading bar when tapping the tab you are already on', async () => {
    const user = userEvent.setup();
    render(<BottomNavigation />);
    await user.click(tab('Train'));
    expect(screen.queryByTestId('tab-nav-progress')).not.toBeInTheDocument();
    expect(tab('Train')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps sub-pages highlighting their section', () => {
    mockPathname = '/dashboard/history';
    render(<BottomNavigation />);
    expect(tab('Train')).toHaveAttribute('aria-current', 'page');
  });
});

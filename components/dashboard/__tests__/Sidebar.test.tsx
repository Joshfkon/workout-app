import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../Sidebar';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

let mockFoodOnly = false;
jest.mock('@/hooks/useTrackingFocus', () => ({
  useTrackingFocus: () => ({ foodOnly: mockFoodOnly, statedFood: mockFoodOnly, setLiftingOn: jest.fn() }),
}));

describe('Sidebar', () => {
  const { usePathname } = require('next/navigation');
  const mockOnSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFoodOnly = false;
  });

  it('shows mobile menu button on non-workout routes', () => {
    usePathname.mockReturnValue('/dashboard');

    const { container } = render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);

    // Mobile menu button should be visible (look for the fixed positioned button)
    const menuButton = container.querySelector('button.fixed.top-4.left-4');
    expect(menuButton).toBeInTheDocument();
  });

  it('hides mobile menu button on active workout routes', () => {
    usePathname.mockReturnValue('/dashboard/workout/test-123');

    const { container } = render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);

    // Mobile menu button should not be in the document
    const menuButton = container.querySelector('button.fixed.top-4.left-4');
    expect(menuButton).not.toBeInTheDocument();
  });

  it('renders sidebar navigation on all routes', () => {
    usePathname.mockReturnValue('/dashboard/workout/test-id');

    const { container } = render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);

    // Sidebar itself should still render (the aside element)
    const sidebar = container.querySelector('aside');
    expect(sidebar).toBeInTheDocument();
    expect(sidebar?.className).toContain('fixed');
  });

  it('labels AI coach as an Elite feature', () => {
    usePathname.mockReturnValue('/dashboard');
    render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);
    const coach = screen.getByRole('link', { name: /AI coach/ });
    expect(coach).toHaveTextContent('Elite');
  });

  it('swaps Train for Weight for a food-only user', () => {
    usePathname.mockReturnValue('/dashboard');
    mockFoodOnly = true;
    render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);
    expect(screen.queryByRole('link', { name: /^Train/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Weight/ })).toHaveAttribute('href', '/dashboard/nutrition/trends');
  });

  // UX panel round 21: the closed drawer was only translated off screen, so
  // its Train / Progress links stayed in the accessibility tree and the
  // first tap on Home went to an off-screen copy.
  it('keeps the closed phone drawer out of reach until the menu opens it', () => {
    usePathname.mockReturnValue('/dashboard');
    render(<Sidebar onSignOut={mockOnSignOut} volumeGoalsMet={false} />);
    const drawer = screen.getByTestId('app-sidebar');
    expect(drawer.className).toMatch(/(^|\s)invisible(\s|$)/);
    expect(drawer.className).toContain('lg:visible');

    const menu = screen.getByRole('button', { name: 'Open menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu);
    expect(drawer.className).not.toMatch(/(^|\s)invisible(\s|$)/);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
  });
});

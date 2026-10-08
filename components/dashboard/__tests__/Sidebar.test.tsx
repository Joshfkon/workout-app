import { render, screen } from '@testing-library/react';
import { Sidebar } from '../Sidebar';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

describe('Sidebar', () => {
  const { usePathname } = require('next/navigation');
  const mockOnSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
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
});

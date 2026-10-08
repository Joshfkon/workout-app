import { render, screen } from '@testing-library/react';
import { DashboardLayoutClient } from '../DashboardLayoutClient';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: jest.fn(),
}));

// Mock supabase client
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: jest.fn(() => ({
    auth: {
      signOut: jest.fn(),
    },
  })),
}));

// Mock child components
jest.mock('../Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

jest.mock('../BottomNavigation', () => ({
  BottomNavigation: () => <div data-testid="bottom-nav">BottomNav</div>,
}));

jest.mock('@/components/workout', () => ({
  ResumeWorkoutBanner: () => <div data-testid="resume-banner">ResumeBanner</div>,
}));

jest.mock('@/hooks/useWeeklyVolume', () => ({
  useWeeklyVolume: () => ({
    tiles: { totalSets: 0, lowCount: 0 },
    isLoading: false,
  }),
}));

jest.mock('@/hooks/useHealthKitSync', () => ({
  useHealthKitForegroundSync: jest.fn(),
}));

jest.mock('@/lib/offline/setOutbox', () => ({
  flushSetOutbox: jest.fn(() => Promise.resolve()),
}));

describe('DashboardLayoutClient', () => {
  const { usePathname } = require('next/navigation');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders app header on non-workout routes', () => {
    usePathname.mockReturnValue('/dashboard');

    render(
      <DashboardLayoutClient>
        <div>Test content</div>
      </DashboardLayoutClient>
    );

    // App header should be visible (look for the logo link)
    const logoLink = screen.getByRole('link', { name: /hypertrack/i });
    expect(logoLink).toBeInTheDocument();
  });

  it('hides app header on active workout routes', () => {
    usePathname.mockReturnValue('/dashboard/workout/abc-123');

    render(
      <DashboardLayoutClient>
        <div>Test content</div>
      </DashboardLayoutClient>
    );

    // App header should not be visible
    const logoLinks = screen.queryAllByRole('link', { name: /hypertrack/i });
    // Filter to only the mobile header logo (not the sidebar one)
    const mobileHeaderLogo = logoLinks.find((link) => 
      link.className.includes('lg:hidden')
    );
    expect(mobileHeaderLogo).toBeUndefined();
  });

  it('shows other dashboard components on workout routes', () => {
    usePathname.mockReturnValue('/dashboard/workout/test-id');

    render(
      <DashboardLayoutClient>
        <div data-testid="page-content">Page content</div>
      </DashboardLayoutClient>
    );

    // Sidebar, bottom nav, and resume banner should still render
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });
});

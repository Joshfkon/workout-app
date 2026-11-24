import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardLayoutClient } from '../DashboardLayoutClient';

// The shell reads the app's QueryClient (sign-out purges it), so render it
// under a provider the way app/(dashboard)/layout.tsx does.
const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

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
  BottomNavigation: ({ onPendingChange }: { onPendingChange?: (href: string | null) => void }) => (
    <div data-testid="bottom-nav">
      <button type="button" onClick={() => onPendingChange?.('/dashboard/analytics')}>
        tap-progress
      </button>
    </div>
  ),
}));

jest.mock('@/components/workout/ResumeWorkoutBanner', () => ({
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
  unparkOutboxEntries: jest.fn(() => Promise.resolve(0)),
}));

const mockGetAiConsent = jest.fn(async () => null);
jest.mock('@/lib/actions/ai-consent', () => ({
  getAiDataSharingConsent: () => mockGetAiConsent(),
  setAiDataSharingConsent: jest.fn(),
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

  it('never asks for AI consent on plain dashboard load', async () => {
    usePathname.mockReturnValue('/dashboard');

    render(
      <DashboardLayoutClient>
        <div>Test content</div>
      </DashboardLayoutClient>
    );

    // Give any mount effects a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('ai-consent-prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Allow AI features?')).not.toBeInTheDocument();
    expect(mockGetAiConsent).not.toHaveBeenCalled();
  });

  it('shows the tapped tab skeleton in place of the old page until it arrives (UX panel r22)', async () => {
    usePathname.mockReturnValue('/dashboard');
    const { rerender } = render(
      <DashboardLayoutClient>
        <div data-testid="page-content">Home page</div>
      </DashboardLayoutClient>
    );
    expect(screen.queryByTestId('tab-pending-skeleton')).not.toBeInTheDocument();
    const { fireEvent } = require('@testing-library/react');
    fireEvent.click(screen.getByText('tap-progress'));
    expect(screen.getByTestId('tab-pending-skeleton')).toHaveTextContent('Progress');
    expect(screen.getByTestId('page-content')).not.toBeVisible();

    // The Progress page arrives: the real page shows, the stand-in goes.
    usePathname.mockReturnValue('/dashboard/analytics');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardLayoutClient>
          <div data-testid="page-content">Progress page</div>
        </DashboardLayoutClient>
      </QueryClientProvider>
    );
    expect(screen.queryByTestId('tab-pending-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeVisible();
  });
});

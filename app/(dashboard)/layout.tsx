import { DashboardLayoutClient } from '@/components/dashboard/DashboardLayoutClient';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { UserStoreHydrator } from '@/components/providers/UserStoreHydrator';
import { OnboardingResumeBanner } from '@/components/onboarding/OnboardingResumeBanner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      {/* Loads the real users row into useUserStore (units, experience,
          custom volume landmarks, Enhanced Athlete Mode, user id). */}
      <UserStoreHydrator />
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
      <OnboardingResumeBanner />
    </QueryProvider>
  );
}

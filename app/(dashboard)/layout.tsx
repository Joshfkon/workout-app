import { DashboardLayoutClient } from '@/components/dashboard/DashboardLayoutClient';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { OnboardingResumeBanner } from '@/components/onboarding/OnboardingResumeBanner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
      <OnboardingResumeBanner />
    </QueryProvider>
  );
}

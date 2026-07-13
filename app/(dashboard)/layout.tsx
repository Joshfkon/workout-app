import { DashboardLayoutClient } from '@/components/dashboard/DashboardLayoutClient';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { AuthSessionRecovery } from '@/components/providers/AuthSessionRecovery';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <AuthSessionRecovery />
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
    </QueryProvider>
  );
}

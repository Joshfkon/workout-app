import { DashboardLayoutClient } from '@/components/dashboard/DashboardLayoutClient';
import { QueryProvider } from '@/components/providers/QueryProvider';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
    </QueryProvider>
  );
}

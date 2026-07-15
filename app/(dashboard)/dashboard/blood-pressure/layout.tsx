import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Blood Pressure' };

export default function bloodPressureLayout({ children }: { children: React.ReactNode }) {
  return children;
}

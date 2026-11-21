import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Blood pressure' };

export default function bloodPressureLayout({ children }: { children: React.ReactNode }) {
  return children;
}

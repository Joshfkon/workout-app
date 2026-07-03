import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'History' };

export default function historyLayout({ children }: { children: React.ReactNode }) {
  return children;
}

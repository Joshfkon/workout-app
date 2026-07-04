import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Feed' };

export default function feedLayout({ children }: { children: React.ReactNode }) {
  return children;
}

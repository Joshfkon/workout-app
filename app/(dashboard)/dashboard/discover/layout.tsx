import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Discover' };

export default function discoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}

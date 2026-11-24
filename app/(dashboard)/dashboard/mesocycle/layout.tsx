import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Training block' };

export default function mesocycleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

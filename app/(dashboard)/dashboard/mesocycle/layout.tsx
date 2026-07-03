import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Mesocycle' };

export default function mesocycleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI coach' };

export default function aicoachLayout({ children }: { children: React.ReactNode }) {
  return children;
}

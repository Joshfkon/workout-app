import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI Coach' };

export default function aicoachLayout({ children }: { children: React.ReactNode }) {
  return children;
}

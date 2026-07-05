import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Learn' };

export default function learnLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Train' };

export default function logLayout({ children }: { children: React.ReactNode }) {
  return children;
}

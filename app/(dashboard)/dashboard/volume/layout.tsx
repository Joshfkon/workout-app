import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Volume' };

export default function volumeLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Search' };

export default function searchLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'More' };

export default function moreLayout({ children }: { children: React.ReactNode }) {
  return children;
}

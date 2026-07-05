import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About' };

export default function aboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}

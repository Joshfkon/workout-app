import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Science' };

export default function scienceLayout({ children }: { children: React.ReactNode }) {
  return children;
}

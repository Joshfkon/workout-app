import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Body composition' };

export default function bodycompositionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

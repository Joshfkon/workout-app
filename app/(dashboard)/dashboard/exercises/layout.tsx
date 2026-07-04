import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Exercises' };

export default function exercisesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

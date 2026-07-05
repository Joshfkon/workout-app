import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Workout' };

export default function workoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}

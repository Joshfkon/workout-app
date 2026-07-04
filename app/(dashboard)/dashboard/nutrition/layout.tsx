import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Nutrition' };

export default function nutritionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

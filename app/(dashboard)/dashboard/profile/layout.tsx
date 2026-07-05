import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Profile' };

export default function profileLayout({ children }: { children: React.ReactNode }) {
  return children;
}

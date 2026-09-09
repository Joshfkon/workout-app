import type { Metadata } from 'next';

// This route redirects to /dashboard/train - metadata kept for consistency
export const metadata: Metadata = { title: 'Train' };

export default function logLayout({ children }: { children: React.ReactNode }) {
  return children;
}

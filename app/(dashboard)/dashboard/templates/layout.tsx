import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Templates' };

export default function templatesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

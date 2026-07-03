import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Glossary' };

export default function glossaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

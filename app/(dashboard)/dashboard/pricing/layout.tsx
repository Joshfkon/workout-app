import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Pricing' };

export default function pricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

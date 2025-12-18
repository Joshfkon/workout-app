'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingAnimation } from '@/components/ui';

// Redirect to combined Analytics page (Body Composition tab)
export default function BodyCompositionPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/analytics');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <LoadingAnimation type="random" size="md" />
      <p className="mt-4 text-surface-400">Redirecting to Analytics...</p>
    </div>
  );
}

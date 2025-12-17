'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingAnimation } from '@/components/ui';

// Redirect to combined Analytics page (Strength tab)
export default function CoachingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/analytics');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <LoadingAnimation type="reps" size="md" />
      <p className="mt-4 text-surface-400">Redirecting to Analytics...</p>
    </div>
  );
}

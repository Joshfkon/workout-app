'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect to combined Analytics page (Strength tab)
export default function CoachingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/analytics');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-surface-400">Redirecting to Analytics...</p>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CreateCustomExercise } from '@/components/exercises/CreateCustomExercise';
import { createUntypedClient } from '@/lib/supabase/client';

export default function AddExercisePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const supabase = createUntypedClient();
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
          router.push('/login');
          return;
        }
        setUserId(user.id);
      } catch (err) {
        console.error('Error getting user:', err);
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    }
    getUser();
  }, [router]);

  const handleSuccess = (exerciseId: string) => {
    router.push('/dashboard/exercises');
  };

  const handleCancel = () => {
    router.back();
  };

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div className="text-center py-12">
          <p className="text-surface-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!userId) {
    return null;
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Add Custom Exercise</h1>
        <p className="text-surface-400 mt-1">
          Enter basic information and let AI fill in the details, or review and adjust as needed
        </p>
      </div>

      <CreateCustomExercise
        userId={userId}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
}


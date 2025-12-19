'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { LoadingAnimation } from '@/components/ui';
import { getLocalDateString } from '@/lib/utils';

export default function QuickWorkoutPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const supabase = createUntypedClient();

  useEffect(() => {
    createQuickWorkout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createQuickWorkout() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const today = getLocalDateString();

      // Check if there's already an active workout session for today
      const { data: existingSession } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('planned_date', today)
        .in('state', ['planned', 'in_progress'])
        .maybeSingle();

      if (existingSession) {
        // Resume existing workout - skip loading screen on destination
        router.replace(`/dashboard/workout/${existingSession.id}?fromCreate=true`);
        return;
      }

      // Create a new quick workout session
      const { data: newSession, error: createError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          planned_date: today,
          state: 'in_progress',
          started_at: new Date().toISOString(),
          completion_percent: 0,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating workout:', createError);
        setError('Failed to create workout. Please try again.');
        return;
      }

      // Go directly to the workout page - skip loading screen on destination
      router.replace(`/dashboard/workout/${newSession.id}?fromCreate=true`);
    } catch (err) {
      console.error('Error:', err);
      setError('Something went wrong. Please try again.');
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <p className="text-danger-400 mb-4">{error}</p>
        <button 
          onClick={() => router.push('/dashboard')}
          className="text-primary-400 hover:underline"
        >
          Go back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <LoadingAnimation />
      <p className="mt-4 text-surface-400">Starting quick workout...</p>
    </div>
  );
}


'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';

export default function WorkoutPage() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);

  // TODO: Fetch real planned workouts from Supabase
  const plannedWorkouts: any[] = [];

  const handleQuickStart = () => {
    setIsStarting(true);
    router.push('/dashboard/workout/new');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workouts</h1>
          <p className="text-surface-400 mt-1">Start a workout or view planned sessions</p>
        </div>
        <Button onClick={handleQuickStart} isLoading={isStarting}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workout
        </Button>
      </div>

      {/* Empty state */}
      {plannedWorkouts.length === 0 && (
        <Card variant="elevated" className="overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">No planned workouts</h2>
            <p className="text-surface-400 mt-2 max-w-md mx-auto">
              Start a quick workout or create a mesocycle to plan your training.
            </p>
            <div className="flex justify-center gap-3 mt-6">
              <Link href="/dashboard/workout/new">
                <Button>Start Quick Workout</Button>
              </Link>
              <Link href="/dashboard/mesocycle/new">
                <Button variant="secondary">Create Mesocycle</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Workout templates */}
      <Card>
        <CardHeader>
          <CardTitle>Workout Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-surface-400 mb-4">
            Quick start with a common split:
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Push', muscles: 'Chest, Shoulders, Triceps', icon: '💪' },
              { name: 'Pull', muscles: 'Back, Biceps, Rear Delts', icon: '🏋️' },
              { name: 'Legs', muscles: 'Quads, Hamstrings, Glutes, Calves', icon: '🦵' },
              { name: 'Upper Body', muscles: 'Chest, Back, Shoulders, Arms', icon: '👆' },
              { name: 'Lower Body', muscles: 'Quads, Hamstrings, Glutes, Calves', icon: '👇' },
              { name: 'Full Body', muscles: 'All muscle groups', icon: '🔥' },
            ].map((template) => (
              <Link
                key={template.name}
                href="/dashboard/workout/new"
                className="p-4 bg-surface-800/50 rounded-lg text-left hover:bg-surface-800 transition-colors group"
              >
                <span className="text-2xl mb-2 block">{template.icon}</span>
                <h4 className="font-medium text-surface-200 group-hover:text-surface-100">
                  {template.name}
                </h4>
                <p className="text-xs text-surface-500 mt-1">{template.muscles}</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { Card, Badge, Button } from '@/components/ui';
import Link from 'next/link';

export default function HistoryPage() {
  // TODO: Fetch real workout history from Supabase
  const workoutHistory: any[] = [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
        <p className="text-surface-400 mt-1">Your past training sessions</p>
      </div>

      {workoutHistory.length === 0 ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No workout history yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Complete your first workout to start building your training history.
          </p>
          <Link href="/dashboard/workout/new">
            <Button className="mt-6">Start Your First Workout</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Workout history cards would go here */}
        </div>
      )}
    </div>
  );
}

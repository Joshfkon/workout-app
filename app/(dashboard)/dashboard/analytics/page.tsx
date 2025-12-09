'use client';

import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import Link from 'next/link';

export default function AnalyticsPage() {
  // TODO: Fetch real analytics data from Supabase
  const hasData = false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Analytics</h1>
        <p className="text-surface-400 mt-1">Track your progress and identify areas for improvement</p>
      </div>

      {!hasData ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No data to analyze yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Complete a few workouts to see your volume tracking, strength progress, and plateau alerts.
          </p>
          <Link href="/dashboard/workout/new">
            <Button className="mt-6">Start Training</Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Analytics content would go here */}
        </>
      )}

      {/* What you'll see section */}
      <Card>
        <CardHeader>
          <CardTitle>What You&apos;ll See Here</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="font-medium text-surface-200">Weekly Volume</h3>
              <p className="text-sm text-surface-500 mt-1">
                Track sets per muscle group against your MEV/MAV/MRV landmarks
              </p>
            </div>
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-success-500/20 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <h3 className="font-medium text-surface-200">Strength Progress</h3>
              <p className="text-sm text-surface-500 mt-1">
                See your estimated 1RM progression over time for each exercise
              </p>
            </div>
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-warning-500/20 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="font-medium text-surface-200">Plateau Alerts</h3>
              <p className="text-sm text-surface-500 mt-1">
                Get notified when progress stalls with suggestions to break through
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

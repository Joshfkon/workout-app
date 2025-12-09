'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@/components/ui';

export default function MesocyclePage() {
  // TODO: Fetch real mesocycle from Supabase
  const currentMesocycle = null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Mesocycle</h1>
          <p className="text-surface-400 mt-1">Plan and track your training blocks</p>
        </div>
        <Link href="/dashboard/mesocycle/new">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Mesocycle
          </Button>
        </Link>
      </div>

      {!currentMesocycle ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No active mesocycle</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Create a mesocycle to plan your training with progressive overload and scheduled deloads.
          </p>
          <Link href="/dashboard/mesocycle/new">
            <Button className="mt-6">Create Your First Mesocycle</Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Mesocycle content would go here */}
        </>
      )}

      {/* What is a mesocycle */}
      <Card>
        <CardHeader>
          <CardTitle>What is a Mesocycle?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-surface-400 mb-4">
            A mesocycle is a training block typically lasting 4-8 weeks, designed to progressively overload your muscles before a recovery (deload) week.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <h3 className="font-medium text-surface-200">📈 Progressive Overload</h3>
              <p className="text-sm text-surface-500 mt-1">
                Gradually increase volume and intensity week over week
              </p>
            </div>
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <h3 className="font-medium text-surface-200">😴 Planned Deloads</h3>
              <p className="text-sm text-surface-500 mt-1">
                Scheduled recovery weeks to manage fatigue
              </p>
            </div>
            <div className="p-4 bg-surface-800/50 rounded-lg">
              <h3 className="font-medium text-surface-200">🎯 Auto-Regulation</h3>
              <p className="text-sm text-surface-500 mt-1">
                Adjust based on readiness and performance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

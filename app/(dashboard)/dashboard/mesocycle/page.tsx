'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

interface Mesocycle {
  id: string;
  name: string;
  state: string;
  total_weeks: number;
  current_week: number;
  days_per_week: number;
  split_type: string;
  deload_week: number;
  created_at: string;
}

export default function MesocyclePage() {
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchMesocycles() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('mesocycles')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && !error) {
        setMesocycles(data);
      }
      setIsLoading(false);
    }
    fetchMesocycles();
  }, []);

  const activeMesocycle = mesocycles.find(m => m.state === 'active');
  const pastMesocycles = mesocycles.filter(m => m.state !== 'active');

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

      {isLoading ? (
        <Card className="text-center py-12">
          <p className="text-surface-400">Loading...</p>
        </Card>
      ) : !activeMesocycle ? (
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
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{activeMesocycle.name}</CardTitle>
                <p className="text-surface-400 text-sm mt-1">{activeMesocycle.split_type}</p>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                <p className="text-2xl font-bold text-surface-100">
                  {activeMesocycle.current_week}/{activeMesocycle.total_weeks}
                </p>
                <p className="text-sm text-surface-500">Current Week</p>
              </div>
              <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                <p className="text-2xl font-bold text-surface-100">{activeMesocycle.days_per_week}</p>
                <p className="text-sm text-surface-500">Days/Week</p>
              </div>
              <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                <p className="text-2xl font-bold text-surface-100">{activeMesocycle.deload_week}</p>
                <p className="text-sm text-surface-500">Deload Week</p>
              </div>
              <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                <p className="text-2xl font-bold text-primary-400">
                  {Math.round((activeMesocycle.current_week / activeMesocycle.total_weeks) * 100)}%
                </p>
                <p className="text-sm text-surface-500">Complete</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm text-surface-400 mb-2">
                <span>Progress</span>
                <span>Week {activeMesocycle.current_week} of {activeMesocycle.total_weeks}</span>
              </div>
              <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all"
                  style={{ width: `${(activeMesocycle.current_week / activeMesocycle.total_weeks) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past mesocycles */}
      {pastMesocycles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Mesocycles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pastMesocycles.map((meso) => (
                <div key={meso.id} className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg">
                  <div>
                    <p className="font-medium text-surface-200">{meso.name}</p>
                    <p className="text-sm text-surface-500">{meso.split_type} • {meso.total_weeks} weeks</p>
                  </div>
                  <Badge variant={meso.state === 'completed' ? 'default' : 'warning'}>
                    {meso.state}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { FFMIGauge } from '@/components/analytics/FFMIGauge';
import { createUntypedClient } from '@/lib/supabase/client';
import type { DexaScan, Goal, Experience, FFMIResult, BodyCompRecommendation } from '@/types/schema';
import {
  calculateFFMI,
  analyzeBodyCompTrend,
  generateCoachingRecommendations,
  calculateBodyCompTargets,
  getFFMILabel,
  getTrendIndicator,
} from '@/services/bodyCompEngine';

interface UserProfile {
  heightCm: number | null;
  goal: Goal;
  experience: Experience;
}

export default function BodyCompositionPage() {
  const [scans, setScans] = useState<DexaScan[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      // Fetch user profile for height and goal
      const { data: profile } = await supabase
        .from('users')
        .select('height_cm, goal, experience')
        .eq('id', user.id)
        .single();

      if (profile) {
        setUserProfile({
          heightCm: profile.height_cm,
          goal: profile.goal || 'maintenance',
          experience: profile.experience || 'intermediate',
        });
      }

      // Fetch DEXA scans
      const { data: scanData } = await supabase
        .from('dexa_scans')
        .select('*')
        .eq('user_id', user.id)
        .order('scan_date', { ascending: false });

      if (scanData) {
        const transformedScans: DexaScan[] = scanData.map((scan: any) => ({
          id: scan.id,
          userId: scan.user_id,
          scanDate: scan.scan_date,
          weightKg: scan.weight_kg,
          leanMassKg: scan.lean_mass_kg,
          fatMassKg: scan.fat_mass_kg,
          bodyFatPercent: scan.body_fat_percent,
          boneMassKg: scan.bone_mass_kg,
          notes: scan.notes,
          createdAt: scan.created_at,
        }));
        setScans(transformedScans);
      }

      setIsLoading(false);
    }

    fetchData();
  }, []);

  // Need height for FFMI calculations
  if (!isLoading && (!userProfile?.heightCm)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Body Composition</h1>
          <p className="text-surface-400 mt-1">Track your DEXA scans and FFMI progress</p>
        </div>

        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">Height Required</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Please add your height in Settings to enable FFMI calculations.
          </p>
          <Link href="/dashboard/settings">
            <Button className="mt-6">Go to Settings</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const latestScan = scans[0];
  const ffmiResult = latestScan && userProfile?.heightCm
    ? calculateFFMI(latestScan.leanMassKg, userProfile.heightCm)
    : null;
  const trend = userProfile?.heightCm
    ? analyzeBodyCompTrend(scans, userProfile.heightCm)
    : null;
  const recommendations = userProfile?.heightCm
    ? generateCoachingRecommendations(scans, userProfile.heightCm, userProfile.goal, userProfile.experience)
    : [];
  const targets = latestScan && userProfile?.heightCm
    ? calculateBodyCompTargets(latestScan, userProfile.heightCm, userProfile.goal, userProfile.experience)
    : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Body Composition</h1>
          <p className="text-surface-400 mt-1">Track your DEXA scans and FFMI progress</p>
        </div>
        <Card className="text-center py-12">
          <p className="text-surface-400">Loading...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Body Composition</h1>
          <p className="text-surface-400 mt-1">Track your DEXA scans and FFMI progress</p>
        </div>
        <Link href="/dashboard/body-composition/add">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add DEXA Scan
          </Button>
        </Link>
      </div>

      {scans.length === 0 ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No DEXA scans yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Add your first DEXA scan to start tracking your body composition and receive personalized coaching recommendations.
          </p>
          <Link href="/dashboard/body-composition/add">
            <Button className="mt-6">Add Your First Scan</Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Stats Overview */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* FFMI Gauge */}
            {ffmiResult && (
              <Card className="md:col-span-2 lg:col-span-1">
                <CardContent className="pt-6 flex justify-center">
                  <FFMIGauge ffmiResult={ffmiResult} size="md" />
                </CardContent>
              </Card>
            )}

            {/* Current Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-surface-400">Body Fat %</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-surface-100">
                  {latestScan.bodyFatPercent}%
                </div>
                {trend && (
                  <div className={`text-sm mt-1 ${getTrendIndicator(trend.bodyFatChangeRate).color}`}>
                    {getTrendIndicator(trend.bodyFatChangeRate).icon} {Math.abs(trend.bodyFatChangeRate).toFixed(1)}%/mo
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-surface-400">Lean Mass</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-surface-100">
                  {latestScan.leanMassKg.toFixed(1)} kg
                </div>
                {trend && (
                  <div className={`text-sm mt-1 ${getTrendIndicator(trend.leanMassChangeRate).color}`}>
                    {getTrendIndicator(trend.leanMassChangeRate).icon} {Math.abs(trend.leanMassChangeRate).toFixed(2)} kg/mo
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-surface-400">Fat Mass</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-surface-100">
                  {latestScan.fatMassKg.toFixed(1)} kg
                </div>
                {trend && (
                  <div className={`text-sm mt-1 ${getTrendIndicator(-trend.fatMassChangeRate).color}`}>
                    {getTrendIndicator(-trend.fatMassChangeRate).icon} {Math.abs(trend.fatMassChangeRate).toFixed(2)} kg/mo
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Targets */}
          {targets && (
            <Card>
              <CardHeader>
                <CardTitle>Your Targets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Target Body Fat</p>
                    <p className="text-2xl font-bold text-surface-100">{targets.targetBodyFat}%</p>
                    <Badge variant={targets.direction === 'cut' ? 'warning' : targets.direction === 'bulk' ? 'success' : 'default'} className="mt-2">
                      {targets.direction === 'cut' ? 'Cutting' : targets.direction === 'bulk' ? 'Bulking' : 'Maintaining'}
                    </Badge>
                  </div>
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Target FFMI</p>
                    <p className="text-2xl font-bold text-surface-100">{targets.targetFfmi}</p>
                    <p className="text-xs text-surface-500 mt-2">
                      {targets.estimatedWeeks > 0 ? `~${targets.estimatedWeeks} weeks` : 'Maintain current'}
                    </p>
                  </div>
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Calorie Adjustment</p>
                    <p className="text-2xl font-bold text-surface-100">
                      {targets.calorieAdjustment > 0 ? '+' : ''}{targets.calorieAdjustment}
                    </p>
                    <p className="text-xs text-surface-500 mt-2">
                      {targets.calorieAdjustment > 0 ? 'surplus' : targets.calorieAdjustment < 0 ? 'deficit' : 'maintenance'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Coaching Recommendations */}
          {recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Coaching Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.map((rec, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        rec.type === 'warning'
                          ? 'bg-warning-500/10 border-warning-500/20'
                          : rec.type === 'achievement'
                          ? 'bg-success-500/10 border-success-500/20'
                          : rec.type === 'suggestion'
                          ? 'bg-primary-500/10 border-primary-500/20'
                          : 'bg-surface-800/50 border-surface-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${
                          rec.type === 'warning' ? 'text-warning-400' :
                          rec.type === 'achievement' ? 'text-success-400' :
                          rec.type === 'suggestion' ? 'text-primary-400' :
                          'text-surface-400'
                        }`}>
                          {rec.type === 'warning' && (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                          {rec.type === 'achievement' && (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                            </svg>
                          )}
                          {rec.type === 'suggestion' && (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                          )}
                          {rec.type === 'info' && (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <h4 className="font-medium text-surface-200">{rec.title}</h4>
                          <p className="text-sm text-surface-400 mt-1">{rec.message}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scan History */}
          <Card>
            <CardHeader>
              <CardTitle>Scan History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-800/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-surface-400 font-medium">Date</th>
                      <th className="px-4 py-2 text-right text-surface-400 font-medium">Weight</th>
                      <th className="px-4 py-2 text-right text-surface-400 font-medium">Lean Mass</th>
                      <th className="px-4 py-2 text-right text-surface-400 font-medium">Fat Mass</th>
                      <th className="px-4 py-2 text-right text-surface-400 font-medium">Body Fat %</th>
                      <th className="px-4 py-2 text-right text-surface-400 font-medium">FFMI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800">
                    {scans.map((scan) => {
                      const scanFfmi = userProfile?.heightCm
                        ? calculateFFMI(scan.leanMassKg, userProfile.heightCm)
                        : null;
                      return (
                        <tr key={scan.id} className="hover:bg-surface-800/30">
                          <td className="px-4 py-3 text-surface-200">
                            {new Date(scan.scanDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-300">
                            {scan.weightKg.toFixed(1)} kg
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-300">
                            {scan.leanMassKg.toFixed(1)} kg
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-300">
                            {scan.fatMassKg.toFixed(1)} kg
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-300">
                            {scan.bodyFatPercent}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-primary-400">
                            {scanFfmi?.normalizedFfmi ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}


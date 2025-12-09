'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { FFMIGauge } from '@/components/analytics/FFMIGauge';
import { createUntypedClient } from '@/lib/supabase/client';
import type { DexaScan, Goal, Experience, FFMIResult, BodyCompRecommendation, DexaRegionalData, RegionalAnalysis } from '@/types/schema';
import {
  calculateFFMI,
  analyzeBodyCompTrend,
  generateCoachingRecommendations,
  calculateBodyCompTargets,
  getFFMILabel,
  getTrendIndicator,
} from '@/services/bodyCompEngine';
import { 
  analyzeRegionalComposition, 
  getAsymmetryRecommendations,
  analyzeRegionalFatDistribution,
  getAsymmetrySeverity
} from '@/services/regionalAnalysis';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';

interface UserProfile {
  heightCm: number | null;
  goal: Goal;
  experience: Experience;
  targetBodyFatPercent: number | null;
}

export default function BodyCompositionPage() {
  const [scans, setScans] = useState<DexaScan[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTargetEditor, setShowTargetEditor] = useState(false);
  const [editingTarget, setEditingTarget] = useState('');
  const [isSavingTarget, setIsSavingTarget] = useState(false);

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
        .select('height_cm, goal, experience, target_body_fat_percent')
        .eq('id', user.id)
        .single();

      if (profile) {
        setUserProfile({
          heightCm: profile.height_cm,
          goal: profile.goal || 'maintenance',
          experience: profile.experience || 'intermediate',
          targetBodyFatPercent: profile.target_body_fat_percent,
        });
        if (profile.target_body_fat_percent) {
          setEditingTarget(String(profile.target_body_fat_percent));
        }
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
          regionalData: scan.regional_data as DexaRegionalData | null,
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
  
  // Regional analysis (if regional data available)
  const regionalAnalysis = latestScan?.regionalData
    ? analyzeRegionalComposition(latestScan.regionalData, latestScan.leanMassKg)
    : null;
  const asymmetryRecs = regionalAnalysis
    ? getAsymmetryRecommendations(regionalAnalysis.asymmetries)
    : [];
  const fatDistribution = latestScan?.regionalData
    ? analyzeRegionalFatDistribution(latestScan.regionalData)
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
          {latestScan && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Your Targets</CardTitle>
                  <button
                    onClick={() => setShowTargetEditor(!showTargetEditor)}
                    className="text-sm text-primary-400 hover:text-primary-300"
                  >
                    {showTargetEditor ? 'Done' : 'Edit'}
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Target Body Fat</p>
                    {showTargetEditor ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          step="0.5"
                          min="5"
                          max="40"
                          value={editingTarget}
                          onChange={(e) => setEditingTarget(e.target.value)}
                          className="w-20 px-2 py-1 bg-surface-900 border border-surface-600 rounded text-xl font-bold text-surface-100 text-center"
                        />
                        <span className="text-xl font-bold text-surface-100">%</span>
                        <button
                          onClick={async () => {
                            setIsSavingTarget(true);
                            const supabase = createUntypedClient();
                            const { data: { user } } = await supabase.auth.getUser();
                            if (user) {
                              await supabase.from('users').update({
                                target_body_fat_percent: parseFloat(editingTarget) || null
                              }).eq('id', user.id);
                              setUserProfile(prev => prev ? { ...prev, targetBodyFatPercent: parseFloat(editingTarget) } : null);
                            }
                            setIsSavingTarget(false);
                            setShowTargetEditor(false);
                          }}
                          disabled={isSavingTarget}
                          className="px-2 py-1 bg-primary-500 text-white rounded text-sm hover:bg-primary-600 disabled:opacity-50"
                        >
                          {isSavingTarget ? '...' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-surface-100">
                          {userProfile?.targetBodyFatPercent ?? targets?.targetBodyFat ?? '—'}%
                        </p>
                        {!userProfile?.targetBodyFatPercent && targets && (
                          <p className="text-xs text-surface-500 mt-1">
                            Auto: {latestScan.bodyFatPercent}% - 5%
                          </p>
                        )}
                      </>
                    )}
                    <Badge variant={targets?.direction === 'cut' ? 'warning' : targets?.direction === 'bulk' ? 'success' : 'default'} className="mt-2">
                      {targets?.direction === 'cut' ? 'Cutting' : targets?.direction === 'bulk' ? 'Bulking' : 'Maintaining'}
                    </Badge>
                  </div>
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Target FFMI</p>
                    <p className="text-2xl font-bold text-surface-100">{targets?.targetFfmi ?? '—'}</p>
                    <p className="text-xs text-surface-500 mt-2">
                      {targets && targets.estimatedWeeks > 0 ? `~${targets.estimatedWeeks} weeks` : 'Maintain current'}
                    </p>
                  </div>
                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <p className="text-sm text-surface-400">Calorie Adjustment</p>
                    <p className="text-2xl font-bold text-surface-100">
                      {targets ? (targets.calorieAdjustment > 0 ? '+' : '') + targets.calorieAdjustment : '—'}
                    </p>
                    <p className="text-xs text-surface-500 mt-2">
                      {targets?.calorieAdjustment && targets.calorieAdjustment > 0 ? 'surplus' : targets?.calorieAdjustment && targets.calorieAdjustment < 0 ? 'deficit' : 'maintenance'}
                    </p>
                  </div>
                </div>
                
                {/* Timeline calculation */}
                {userProfile?.targetBodyFatPercent && latestScan && (
                  <div className="mt-4 p-3 bg-surface-800/30 rounded-lg text-sm">
                    <p className="text-surface-400">
                      <span className="text-surface-200 font-medium">To reach {userProfile.targetBodyFatPercent}%:</span> You need to lose{' '}
                      <span className="text-primary-400 font-medium">
                        {(latestScan.bodyFatPercent - userProfile.targetBodyFatPercent).toFixed(1)}%
                      </span>{' '}
                      body fat ({((latestScan.bodyFatPercent - userProfile.targetBodyFatPercent) / 0.5).toFixed(0)} weeks at 0.5%/week)
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* FFMI Calculation Breakdown */}
          {ffmiResult && userProfile?.heightCm && latestScan && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">FFMI Calculation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm font-mono">
                  <div className="flex justify-between">
                    <span className="text-surface-400">Lean Mass:</span>
                    <span className="text-surface-200">{latestScan.leanMassKg.toFixed(1)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-400">Height:</span>
                    <span className="text-surface-200">{userProfile.heightCm} cm ({(userProfile.heightCm / 100).toFixed(2)} m)</span>
                  </div>
                  <div className="border-t border-surface-700 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-surface-400">Raw FFMI:</span>
                      <span className="text-surface-200">
                        {latestScan.leanMassKg.toFixed(1)} ÷ {((userProfile.heightCm / 100) ** 2).toFixed(3)} = {(latestScan.leanMassKg / ((userProfile.heightCm / 100) ** 2)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-surface-400">Normalized FFMI:</span>
                      <span className="text-primary-400 font-bold">{ffmiResult.normalizedFfmi}</span>
                    </div>
                  </div>
                  <p className="text-xs text-surface-500 mt-2">
                    Normalized = Raw FFMI + 6.1 × (1.8 - height in m)
                  </p>
                </div>
                {userProfile.heightCm < 165 || userProfile.heightCm > 195 ? (
                  <p className="text-xs text-warning-400 mt-3">
                    ⚠️ Your height ({userProfile.heightCm} cm) seems unusual. Please verify in Settings.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Regional Body Composition Analysis */}
          {regionalAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Regional Analysis
                  <Badge variant="info" size="sm">From DEXA</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Body Part Distribution */}
                <div>
                  <h4 className="text-sm font-medium text-surface-400 mb-3">Lean Mass Distribution</h4>
                  <div className="space-y-3">
                    {regionalAnalysis.parts.map((part) => (
                      <div key={part.name} className="flex items-center gap-3">
                        <div className="w-16 text-sm text-surface-400">{part.name}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 bg-surface-800 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  part.status === 'lagging' ? 'bg-warning-500' :
                                  part.status === 'dominant' ? 'bg-success-500' :
                                  'bg-primary-500'
                                }`}
                                style={{ width: `${Math.min(100, (part.percentOfTotal / 50) * 100)}%` }}
                              />
                            </div>
                            <span className="text-sm font-mono text-surface-200 w-16">
                              {part.leanMassKg.toFixed(1)} kg
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-surface-500">{part.percentOfTotal}% of total</span>
                            {part.symmetryScore && (
                              <span className={`text-xs ${part.symmetryScore >= 95 ? 'text-success-400' : part.symmetryScore >= 90 ? 'text-warning-400' : 'text-danger-400'}`}>
                                • Symmetry: {part.symmetryScore.toFixed(0)}%
                              </span>
                            )}
                            <Badge 
                              variant={part.status === 'lagging' ? 'warning' : part.status === 'dominant' ? 'success' : 'default'} 
                              size="sm"
                            >
                              {part.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Asymmetry Analysis */}
                {(Math.abs(regionalAnalysis.asymmetries.arms) >= 3 || Math.abs(regionalAnalysis.asymmetries.legs) >= 3) && (
                  <div className="p-4 bg-warning-500/10 border border-warning-500/20 rounded-lg">
                    <h4 className="text-sm font-medium text-warning-400 mb-2">⚠️ Asymmetry Detected</h4>
                    <div className="space-y-2 text-sm">
                      {Math.abs(regionalAnalysis.asymmetries.arms) >= 3 && (
                        <p className="text-surface-300">
                          <strong>Arms:</strong> {regionalAnalysis.asymmetries.arms > 0 ? 'Right' : 'Left'} arm is {Math.abs(regionalAnalysis.asymmetries.arms).toFixed(1)}% larger
                          <span className={`ml-2 ${
                            getAsymmetrySeverity(regionalAnalysis.asymmetries.arms) === 'significant' ? 'text-danger-400' :
                            getAsymmetrySeverity(regionalAnalysis.asymmetries.arms) === 'moderate' ? 'text-warning-400' :
                            'text-surface-500'
                          }`}>
                            ({getAsymmetrySeverity(regionalAnalysis.asymmetries.arms)})
                          </span>
                        </p>
                      )}
                      {Math.abs(regionalAnalysis.asymmetries.legs) >= 3 && (
                        <p className="text-surface-300">
                          <strong>Legs:</strong> {regionalAnalysis.asymmetries.legs > 0 ? 'Right' : 'Left'} leg is {Math.abs(regionalAnalysis.asymmetries.legs).toFixed(1)}% larger
                          <span className={`ml-2 ${
                            getAsymmetrySeverity(regionalAnalysis.asymmetries.legs) === 'significant' ? 'text-danger-400' :
                            getAsymmetrySeverity(regionalAnalysis.asymmetries.legs) === 'moderate' ? 'text-warning-400' :
                            'text-surface-500'
                          }`}>
                            ({getAsymmetrySeverity(regionalAnalysis.asymmetries.legs)})
                          </span>
                        </p>
                      )}
                    </div>
                    {asymmetryRecs.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-warning-500/20">
                        <p className="text-xs text-warning-300 font-medium mb-1">Recommendations:</p>
                        <ul className="text-xs text-surface-400 space-y-1">
                          {asymmetryRecs.map((rec, i) => (
                            <li key={i}>• {rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Lagging/Dominant Areas Summary */}
                {(regionalAnalysis.laggingAreas.length > 0 || regionalAnalysis.dominantAreas.length > 0) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {regionalAnalysis.laggingAreas.length > 0 && (
                      <div className="p-3 bg-surface-800/50 rounded-lg">
                        <p className="text-xs font-medium text-warning-400 mb-2">Areas Needing Focus</p>
                        <div className="flex flex-wrap gap-2">
                          {regionalAnalysis.laggingAreas.map((area, i) => (
                            <Badge key={i} variant="warning" size="sm">{area}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {regionalAnalysis.dominantAreas.length > 0 && (
                      <div className="p-3 bg-surface-800/50 rounded-lg">
                        <p className="text-xs font-medium text-success-400 mb-2">Strong Areas</p>
                        <div className="flex flex-wrap gap-2">
                          {regionalAnalysis.dominantAreas.map((area, i) => (
                            <Badge key={i} variant="success" size="sm">{area}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Fat Distribution Health Indicator */}
                {fatDistribution && (
                  <div className="p-4 bg-surface-800/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-surface-300">Android/Gynoid Ratio</h4>
                      <Badge 
                        variant={
                          fatDistribution.healthRisk === 'low' ? 'success' :
                          fatDistribution.healthRisk === 'moderate' ? 'info' :
                          fatDistribution.healthRisk === 'elevated' ? 'warning' :
                          'danger'
                        }
                        size="sm"
                      >
                        {fatDistribution.healthRisk} risk
                      </Badge>
                    </div>
                    <p className="text-2xl font-bold text-surface-100">{fatDistribution.androidGynoidRatio}</p>
                    <p className="text-xs text-surface-500 mt-1">{fatDistribution.interpretation}</p>
                  </div>
                )}

                {/* Part-specific recommendations */}
                {regionalAnalysis.parts.some(p => p.recommendation) && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-surface-400">Training Recommendations</h4>
                    {regionalAnalysis.parts.filter(p => p.recommendation).map((part, i) => (
                      <div key={i} className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg text-sm text-surface-300">
                        <strong>{part.name}:</strong> {part.recommendation}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Prompt to add regional data */}
          {latestScan && !latestScan.regionalData && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-800 flex items-center justify-center">
                  <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <p className="text-surface-300 font-medium">Unlock Regional Analysis</p>
                <p className="text-sm text-surface-500 mt-1 max-w-sm mx-auto">
                  Add regional data (arms, legs, trunk) from your next DEXA scan to identify weak areas and get better weight recommendations.
                </p>
                <Link href="/dashboard/body-composition/add">
                  <Button variant="outline" className="mt-4">
                    Add Regional Data
                  </Button>
                </Link>
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

          {/* Progress Charts */}
          {scans.length >= 2 && (
            <>
              {/* Body Composition Trend Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Body Composition Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[...scans].reverse().map(scan => ({
                        date: new Date(scan.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        fullDate: scan.scanDate,
                        weight: scan.weightKg,
                        leanMass: scan.leanMassKg,
                        fatMass: scan.fatMassKg,
                      }))}>
                        <defs>
                          <linearGradient id="leanGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="fatGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                        <YAxis stroke="#9ca3af" fontSize={12} domain={['dataMin - 2', 'dataMax + 2']} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#1f2937', 
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#f3f4f6'
                          }}
                          formatter={(value: number, name: string) => [
                            `${value.toFixed(1)} kg`,
                            name === 'leanMass' ? 'Lean Mass' : name === 'fatMass' ? 'Fat Mass' : 'Total Weight'
                          ]}
                        />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="leanMass" 
                          name="Lean Mass"
                          stroke="#22c55e" 
                          fill="url(#leanGradient)"
                          strokeWidth={2}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="fatMass" 
                          name="Fat Mass"
                          stroke="#f59e0b" 
                          fill="url(#fatGradient)"
                          strokeWidth={2}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="weight" 
                          name="Total Weight"
                          stroke="#8b5cf6" 
                          strokeWidth={2}
                          dot={{ fill: '#8b5cf6', strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Body Fat % and FFMI Chart */}
              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Body Fat % Progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={[...scans].reverse().map(scan => ({
                          date: new Date(scan.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                          bodyFat: scan.bodyFatPercent,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="date" stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} domain={['dataMin - 2', 'dataMax + 2']} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1f2937', 
                              border: '1px solid #374151',
                              borderRadius: '8px',
                              color: '#f3f4f6'
                            }}
                            formatter={(value: number) => [`${value.toFixed(1)}%`, 'Body Fat']}
                          />
                          {userProfile?.targetBodyFatPercent && (
                            <ReferenceLine 
                              y={userProfile.targetBodyFatPercent} 
                              stroke="#22c55e" 
                              strokeDasharray="5 5"
                              label={{ value: 'Target', fill: '#22c55e', fontSize: 10 }}
                            />
                          )}
                          <Line 
                            type="monotone" 
                            dataKey="bodyFat" 
                            stroke="#f59e0b" 
                            strokeWidth={2}
                            dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">FFMI Progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={[...scans].reverse().map(scan => ({
                          date: new Date(scan.scanDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                          ffmi: userProfile?.heightCm 
                            ? calculateFFMI(scan.leanMassKg, userProfile.heightCm).normalizedFfmi 
                            : 0,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="date" stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1f2937', 
                              border: '1px solid #374151',
                              borderRadius: '8px',
                              color: '#f3f4f6'
                            }}
                            formatter={(value: number) => [value.toFixed(1), 'FFMI']}
                          />
                          <ReferenceLine 
                            y={25} 
                            stroke="#ef4444" 
                            strokeDasharray="5 5"
                            label={{ value: 'Natural Limit', fill: '#ef4444', fontSize: 10 }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="ffmi" 
                            stroke="#8b5cf6" 
                            strokeWidth={2}
                            dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Cut/Bulk Performance Analysis */}
              {scans.length >= 2 && (() => {
                const sortedScans = [...scans].sort((a, b) => 
                  new Date(a.scanDate).getTime() - new Date(b.scanDate).getTime()
                );
                const firstScan = sortedScans[0];
                const lastScan = sortedScans[sortedScans.length - 1];
                
                const daysBetween = Math.round(
                  (new Date(lastScan.scanDate).getTime() - new Date(firstScan.scanDate).getTime()) 
                  / (1000 * 60 * 60 * 24)
                );
                const weeksBetween = Math.round(daysBetween / 7);
                
                const weightChange = lastScan.weightKg - firstScan.weightKg;
                const leanChange = lastScan.leanMassKg - firstScan.leanMassKg;
                const fatChange = lastScan.fatMassKg - firstScan.fatMassKg;
                const bfChange = lastScan.bodyFatPercent - firstScan.bodyFatPercent;
                
                // Determine phase type
                let phase: 'bulk' | 'cut' | 'recomp' | 'maintenance';
                if (weightChange > 1 && leanChange > 0) {
                  phase = fatChange < leanChange * 0.5 ? 'bulk' : 'bulk';
                } else if (weightChange < -1 && fatChange < 0) {
                  phase = 'cut';
                } else if (leanChange > 0 && fatChange < 0) {
                  phase = 'recomp';
                } else {
                  phase = 'maintenance';
                }
                
                // Calculate efficiency metrics
                const leanGainRate = leanChange / Math.max(1, weeksBetween);  // kg/week
                const fatLossRate = -fatChange / Math.max(1, weeksBetween);   // kg/week
                const partitioningRatio = leanChange !== 0 ? (leanChange / (leanChange + Math.abs(fatChange))) * 100 : 0;
                
                // Grade the phase
                let grade: 'A' | 'B' | 'C' | 'D' | 'F';
                let analysis: string;
                
                if (phase === 'bulk') {
                  // Good bulk: gain lean with minimal fat, ratio > 60%
                  if (partitioningRatio >= 70) { grade = 'A'; analysis = 'Excellent lean gains with minimal fat accumulation!'; }
                  else if (partitioningRatio >= 55) { grade = 'B'; analysis = 'Good progress. Most weight gained is muscle.'; }
                  else if (partitioningRatio >= 40) { grade = 'C'; analysis = 'Decent gains, but consider a smaller calorie surplus.'; }
                  else if (partitioningRatio >= 25) { grade = 'D'; analysis = 'Gaining too much fat. Reduce surplus or increase activity.'; }
                  else { grade = 'F'; analysis = 'Mostly fat gain. Reassess nutrition and training.'; }
                } else if (phase === 'cut') {
                  // Good cut: lose fat while preserving lean mass
                  const leanRetention = leanChange >= 0 ? 100 : 100 - Math.abs(leanChange / fatChange) * 100;
                  if (leanRetention >= 95 && fatLossRate >= 0.3) { grade = 'A'; analysis = 'Perfect cut! Losing fat while preserving muscle.'; }
                  else if (leanRetention >= 85) { grade = 'B'; analysis = 'Good cut with minimal muscle loss.'; }
                  else if (leanRetention >= 70) { grade = 'C'; analysis = 'Losing some muscle. Consider more protein or slower cut.'; }
                  else if (leanRetention >= 50) { grade = 'D'; analysis = 'Significant muscle loss. Slow down the deficit.'; }
                  else { grade = 'F'; analysis = 'Too aggressive. Losing too much muscle.'; }
                } else if (phase === 'recomp') {
                  grade = 'A';
                  analysis = 'Successful recomposition! Gained muscle while losing fat.';
                } else {
                  grade = 'B';
                  analysis = 'Maintenance phase with minimal changes.';
                }
                
                return (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>Phase Performance Analysis</CardTitle>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold ${
                          grade === 'A' ? 'bg-success-500/20 text-success-400' :
                          grade === 'B' ? 'bg-primary-500/20 text-primary-400' :
                          grade === 'C' ? 'bg-warning-500/20 text-warning-400' :
                          grade === 'D' ? 'bg-orange-500/20 text-orange-400' :
                          'bg-danger-500/20 text-danger-400'
                        }`}>
                          {grade}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Badge 
                          variant={phase === 'bulk' ? 'success' : phase === 'cut' ? 'warning' : phase === 'recomp' ? 'info' : 'default'}
                          size="md"
                        >
                          {phase === 'bulk' ? '💪 Bulking' : 
                           phase === 'cut' ? '🔥 Cutting' : 
                           phase === 'recomp' ? '🔄 Recomposition' : 
                           '⚖️ Maintenance'}
                        </Badge>
                        <span className="text-surface-400 text-sm">
                          {weeksBetween} weeks ({daysBetween} days)
                        </span>
                      </div>
                      
                      <p className="text-surface-300">{analysis}</p>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 bg-surface-800/50 rounded-lg">
                          <p className="text-xs text-surface-500">Weight Change</p>
                          <p className={`text-xl font-bold ${weightChange > 0 ? 'text-success-400' : weightChange < 0 ? 'text-warning-400' : 'text-surface-300'}`}>
                            {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1)} kg
                          </p>
                        </div>
                        <div className="p-3 bg-surface-800/50 rounded-lg">
                          <p className="text-xs text-surface-500">Lean Mass Change</p>
                          <p className={`text-xl font-bold ${leanChange > 0 ? 'text-success-400' : leanChange < 0 ? 'text-danger-400' : 'text-surface-300'}`}>
                            {leanChange > 0 ? '+' : ''}{leanChange.toFixed(1)} kg
                          </p>
                        </div>
                        <div className="p-3 bg-surface-800/50 rounded-lg">
                          <p className="text-xs text-surface-500">Fat Mass Change</p>
                          <p className={`text-xl font-bold ${fatChange < 0 ? 'text-success-400' : fatChange > 0 ? 'text-warning-400' : 'text-surface-300'}`}>
                            {fatChange > 0 ? '+' : ''}{fatChange.toFixed(1)} kg
                          </p>
                        </div>
                        <div className="p-3 bg-surface-800/50 rounded-lg">
                          <p className="text-xs text-surface-500">Body Fat Change</p>
                          <p className={`text-xl font-bold ${bfChange < 0 ? 'text-success-400' : bfChange > 0 ? 'text-warning-400' : 'text-surface-300'}`}>
                            {bfChange > 0 ? '+' : ''}{bfChange.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      
                      {/* Detailed metrics */}
                      <div className="pt-4 border-t border-surface-700 grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs text-surface-500">Partitioning Ratio</p>
                          <p className="text-lg font-semibold text-surface-200">{partitioningRatio.toFixed(0)}% muscle</p>
                          <p className="text-xs text-surface-600">% of weight change as lean mass</p>
                        </div>
                        {phase === 'bulk' && (
                          <div>
                            <p className="text-xs text-surface-500">Lean Gain Rate</p>
                            <p className="text-lg font-semibold text-surface-200">{(leanGainRate * 4.33).toFixed(2)} kg/mo</p>
                            <p className="text-xs text-surface-600">Natural max ~0.5-1 kg/mo</p>
                          </div>
                        )}
                        {phase === 'cut' && (
                          <div>
                            <p className="text-xs text-surface-500">Fat Loss Rate</p>
                            <p className="text-lg font-semibold text-surface-200">{(fatLossRate * 4.33).toFixed(2)} kg/mo</p>
                            <p className="text-xs text-surface-600">Ideal: 0.5-1% BW/week</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-surface-500">Period</p>
                          <p className="text-lg font-semibold text-surface-200">
                            {new Date(firstScan.scanDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })} → {new Date(lastScan.scanDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </>
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


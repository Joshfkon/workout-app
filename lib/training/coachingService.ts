// ============================================================
// COACHING SERVICE
// Manages strength calibration and onboarding flow
// ============================================================

import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import type {
  Sex,
  BodyComposition,
  CalibrationResult,
  StrengthProfileData,
  StrengthLevel,
  PercentileScore,
  StrengthImbalance,
  CoachingSessionRow,
  BenchmarkLift,
} from '@/types/training';
import { BENCHMARK_LIFTS } from './constants';
import { calculateBodyComposition, estimate1RM } from './programEngine';

// ============================================================
// COACHING SERVICE CLASS
// ============================================================

export class CoachingService {
  private userId: string;
  private supabase: ReturnType<typeof createUntypedClient>;
  
  constructor(userId: string) {
    this.userId = userId;
    this.supabase = createUntypedClient();
  }
  
  async getOrCreateSession(): Promise<CoachingSessionRow> {
    const { data: existing } = await this.supabase
      .from('coaching_sessions')
      .select('*')
      .eq('user_id', this.userId)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (existing) {
      return existing as CoachingSessionRow;
    }
    
    const { data, error } = await this.supabase
      .from('coaching_sessions')
      .insert({
        user_id: this.userId,
        status: 'not_started',
        selected_benchmarks: [],
        completed_benchmarks: [],
      })
      .select()
      .single();
    
    if (error || !data) throw new Error('Failed to create coaching session');
    return data as CoachingSessionRow;
  }
  
  async getCompletedSession(): Promise<CoachingSessionRow | null> {
    const { data } = await this.supabase
      .from('coaching_sessions')
      .select('*')
      .eq('user_id', this.userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();
    
    return data as CoachingSessionRow | null;
  }
  
  async saveBodyComposition(
    heightCm: number,
    weightKg: number,
    bodyFatPercent: number,
    source: string = 'manual'
  ): Promise<BodyComposition> {
    const bodyComp = calculateBodyComposition(weightKg, bodyFatPercent, heightCm);
    
    await this.supabase.from('dexa_scans').insert({
      user_id: this.userId,
      scan_date: getLocalDateString(),
      weight_kg: weightKg,
      lean_mass_kg: bodyComp.leanMassKg,
      fat_mass_kg: weightKg - bodyComp.leanMassKg,
      body_fat_percent: bodyFatPercent,
      notes: source
    });
    
    await this.supabase
      .from('users')
      .update({ height_cm: heightCm, weight_kg: weightKg })
      .eq('id', this.userId);
    
    await this.supabase
      .from('coaching_sessions')
      .update({ status: 'in_progress', body_composition: bodyComp })
      .eq('user_id', this.userId)
      .neq('status', 'completed');
    
    return bodyComp;
  }
  
  async getLatestBodyComposition(): Promise<BodyComposition | null> {
    const { data: userData } = await this.supabase
      .from('users')
      .select('height_cm, weight_kg')
      .eq('id', this.userId)
      .single();
    
    const { data: dexaData } = await this.supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', this.userId)
      .order('scan_date', { ascending: false })
      .limit(1)
      .single();
    
    if (!dexaData) return null;
    
    const heightCm = userData?.height_cm || 175;
    return calculateBodyComposition(dexaData.weight_kg, dexaData.body_fat_percent, heightCm);
  }
  
  getBenchmarkLifts(): BenchmarkLift[] {
    return BENCHMARK_LIFTS;
  }
  
  getBenchmarkById(id: string): BenchmarkLift | undefined {
    return BENCHMARK_LIFTS.find(b => b.id === id);
  }
  
  async selectBenchmarks(benchmarkIds: string[]): Promise<void> {
    await this.supabase
      .from('coaching_sessions')
      .update({ selected_benchmarks: benchmarkIds, status: 'in_progress' })
      .eq('user_id', this.userId)
      .neq('status', 'completed');
  }
  
  async recordCalibrationResult(
    benchmarkId: string,
    weight: number,
    reps: number,
    rpe: number,
    sex: Sex
  ): Promise<CalibrationResult> {
    const benchmark = this.getBenchmarkById(benchmarkId);
    if (!benchmark) throw new Error('Unknown benchmark');
    
    const bodyComp = await this.getLatestBodyComposition();
    if (!bodyComp) throw new Error('No body composition data');
    
    const estimated1RM = estimate1RM(weight, reps, rpe);
    
    const ratio = estimated1RM / bodyComp.totalWeightKg;
    const table = sex === 'male' 
      ? benchmark.populationPercentiles.male 
      : benchmark.populationPercentiles.female;
    
    const vsGeneral = this.getPercentile(ratio, table);
    const percentileScore: PercentileScore = {
      vsGeneralPopulation: Math.round(vsGeneral),
      vsTrainedPopulation: Math.round(Math.max(1, vsGeneral - 20)),
      vsBodyComposition: Math.round(vsGeneral)
    };
    
    const strengthLevel = this.calculateStrengthLevel(percentileScore.vsTrainedPopulation);
    
    const { data: session } = await this.supabase
      .from('coaching_sessions')
      .select('id')
      .eq('user_id', this.userId)
      .neq('status', 'completed')
      .single();
    
    await this.supabase.from('calibrated_lifts').insert({
      user_id: this.userId,
      coaching_session_id: session?.id,
      benchmark_id: benchmarkId,
      lift_name: benchmark.name,
      tested_weight_kg: weight,
      tested_reps: reps,
      tested_rpe: rpe,
      estimated_1rm: estimated1RM,
      percentile_vs_general: percentileScore.vsGeneralPopulation,
      percentile_vs_trained: percentileScore.vsTrainedPopulation,
      percentile_vs_body_comp: percentileScore.vsBodyComposition,
      strength_level: strengthLevel
    });
    
    const { data: currentSession } = await this.supabase
      .from('coaching_sessions')
      .select('completed_benchmarks')
      .eq('user_id', this.userId)
      .neq('status', 'completed')
      .single();
    
    const completed = [...(currentSession?.completed_benchmarks || []), benchmarkId];
    await this.supabase
      .from('coaching_sessions')
      .update({ completed_benchmarks: completed })
      .eq('user_id', this.userId)
      .neq('status', 'completed');
    
    return {
      lift: benchmark.name,
      benchmarkId,
      testedWeight: weight,
      testedReps: reps,
      testedRPE: rpe,
      estimated1RM,
      percentileScore,
      strengthLevel
    };
  }
  
  private getPercentile(value: number, table: Record<number, number>): number {
    const percentiles = Object.keys(table).map(Number).sort((a, b) => a - b);
    
    for (let i = 0; i < percentiles.length; i++) {
      const p = percentiles[i];
      const threshold = table[p];
      
      if (value < threshold) {
        if (i === 0) return p / 2;
        const prevP = percentiles[i - 1];
        const prevThreshold = table[prevP];
        const ratio = (value - prevThreshold) / (threshold - prevThreshold);
        return prevP + ratio * (p - prevP);
      }
    }
    
    return 99;
  }
  
  private calculateStrengthLevel(percentile: number): StrengthLevel {
    if (percentile < 10) return 'untrained';
    if (percentile < 25) return 'beginner';
    if (percentile < 50) return 'novice';
    if (percentile < 75) return 'intermediate';
    if (percentile < 95) return 'advanced';
    return 'elite';
  }
  
  async completeCoaching(): Promise<StrengthProfileData> {
    const { data: calibrations } = await this.supabase
      .from('calibrated_lifts')
      .select('*')
      .eq('user_id', this.userId);
    
    const bodyComp = await this.getLatestBodyComposition();
    
    if (!calibrations || calibrations.length === 0 || !bodyComp) {
      throw new Error('Missing data for strength profile');
    }
    
    const calibratedLifts: CalibrationResult[] = calibrations.map((cal: any) => ({
      lift: cal.lift_name,
      benchmarkId: cal.benchmark_id,
      testedWeight: cal.tested_weight_kg,
      testedReps: cal.tested_reps,
      testedRPE: cal.tested_rpe,
      estimated1RM: cal.estimated_1rm,
      percentileScore: {
        vsGeneralPopulation: cal.percentile_vs_general || 50,
        vsTrainedPopulation: cal.percentile_vs_trained || 50,
        vsBodyComposition: cal.percentile_vs_body_comp || 50
      },
      strengthLevel: (cal.strength_level || 'novice') as StrengthLevel
    }));
    
    const weights: Record<string, number> = {
      'Barbell Bench Press': 1.0,
      'Barbell Back Squat': 1.2,
      'Conventional Deadlift': 1.2,
      'Standing Overhead Press': 0.8,
      'Barbell Row': 0.9
    };
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const cal of calibratedLifts) {
      const w = weights[cal.lift] || 1.0;
      weightedSum += cal.percentileScore.vsTrainedPopulation * w;
      totalWeight += w;
    }
    
    const overallScore = Math.round(weightedSum / totalWeight);
    const strengthLevel = this.calculateStrengthLevel(overallScore);
    
    const imbalances = this.analyzeImbalances(calibratedLifts);
    const balanceScore = Math.max(0, 100 - imbalances.length * 15);
    
    const recommendations = this.generateRecommendations(overallScore, imbalances, bodyComp);
    
    const strengthProfile: StrengthProfileData = {
      overallScore,
      strengthLevel,
      balanceScore,
      imbalances,
      calibratedLifts,
      bodyComposition: bodyComp,
      recommendations
    };
    
    await this.supabase
      .from('coaching_sessions')
      .update({
        status: 'completed',
        strength_profile: strengthProfile,
        completed_at: new Date().toISOString()
      })
      .eq('user_id', this.userId)
      .neq('status', 'completed');
    
    await this.supabase
      .from('users')
      .update({ onboarding_completed: true })
      .eq('id', this.userId);
    
    return strengthProfile;
  }
  
  private analyzeImbalances(lifts: CalibrationResult[]): StrengthImbalance[] {
    const imbalances: StrengthImbalance[] = [];
    
    const maxes: Record<string, number> = {};
    for (const lift of lifts) {
      maxes[lift.lift] = lift.estimated1RM;
    }
    
    if (maxes['Barbell Bench Press'] && maxes['Barbell Row']) {
      const ratio = maxes['Barbell Row'] / maxes['Barbell Bench Press'];
      if (ratio < 0.65) {
        imbalances.push({
          type: 'push_pull',
          description: 'Pushing strength exceeds pulling strength',
          severity: ratio < 0.5 ? 'significant' : 'moderate',
          recommendation: 'Add more rowing and pulling volume'
        });
      }
    }
    
    if (maxes['Barbell Bench Press'] && maxes['Barbell Back Squat']) {
      const ratio = maxes['Barbell Bench Press'] / maxes['Barbell Back Squat'];
      if (ratio > 0.9) {
        imbalances.push({
          type: 'upper_lower',
          description: 'Upper body strong relative to lower body',
          severity: ratio > 1.0 ? 'significant' : 'moderate',
          recommendation: 'Prioritize squat variations and leg development'
        });
      }
    }
    
    return imbalances;
  }
  
  private generateRecommendations(
    score: number, 
    imbalances: StrengthImbalance[],
    bodyComp: BodyComposition
  ): string[] {
    const recs: string[] = [];
    
    if (score < 25) {
      recs.push('Focus on building foundational strength with linear progression.');
    } else if (score < 50) {
      recs.push('Continue building strength with moderate volume.');
    } else if (score < 75) {
      recs.push('Solid strength. Focus on periodization and weak points.');
    } else {
      recs.push('Advanced strength level. Consider specialized programming.');
    }
    
    if (bodyComp.ffmi < 20) {
      recs.push('Room for muscle growth. Prioritize hypertrophy training.');
    }
    
    for (const imb of imbalances) {
      if (imb.severity !== 'minor') {
        recs.push(imb.recommendation);
      }
    }
    
    return recs;
  }
  
  async getCalibratedLifts(): Promise<CalibrationResult[]> {
    const { data } = await this.supabase
      .from('calibrated_lifts')
      .select('*')
      .eq('user_id', this.userId)
      .order('tested_at', { ascending: false });
    
    if (!data) return [];
    
    return data.map((cal: any) => ({
      lift: cal.lift_name,
      benchmarkId: cal.benchmark_id,
      testedWeight: cal.tested_weight_kg,
      testedReps: cal.tested_reps,
      testedRPE: cal.tested_rpe,
      estimated1RM: cal.estimated_1rm,
      percentileScore: {
        vsGeneralPopulation: cal.percentile_vs_general || 50,
        vsTrainedPopulation: cal.percentile_vs_trained || 50,
        vsBodyComposition: cal.percentile_vs_body_comp || 50
      },
      strengthLevel: (cal.strength_level || 'novice') as StrengthLevel
    }));
  }
}


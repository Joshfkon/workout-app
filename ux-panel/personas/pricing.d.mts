export type Segment = 'lifting' | 'food-only' | 'both';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
type Weights = Record<string, number>;

export interface Quotas {
  segment: Record<Segment, number>;
  gender: Record<Segment, Weights>;
  age: Record<Segment, Weights>;
  income: Weights;
  experience: Record<ExperienceLevel, number>;
  currentApp: Record<Segment, Weights>;
}
export const QUOTAS: Quotas;
export const AGE_RANGES: Record<string, [number, number]>;
export const APPS: Record<string, { name: string; paidMonthly: number; paidShare: number; paidName?: string; kind: 'lifting' | 'food' | 'any' }>;

export interface PricingBlock {
  segment: Segment;
  gender: 'male' | 'female';
  ageBand: string;
  income: string;
  experienceLevel: ExperienceLevel;
  currentApp: string;
  currentApps: string[];
  monthlySpend: number;
  spendLine: string;
  typicalWeek: string[];
  featuresTouched: string[];
}
export interface PricingPersona {
  id: string;
  name: string;
  age: number;
  summary: string;
  goals: string;
  experience: string;
  patience: number;
  techComfort: number;
  previousApps: string;
  account: { goal: string; experience: string; units: 'lb' | 'kg'; sex: string; weightKg: number; heightCm: number; birthYear: number; history: string; split?: string; tier?: string };
  skip?: string[];
  journeys?: string[];
  pricing: PricingBlock;
}

export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  pick<T>(xs: T[]): T;
  chance(p: number): boolean;
  shuffle<T>(xs: T[]): T[];
}
export function rng(seed: string | number): Rng;
export function allocate(n: number, weights: Weights): Record<string, number>;
export function samplePricingPersonas(opts?: { n?: number; seed?: number | string; quotas?: Quotas }): PricingPersona[];
export function quotaBalancedSubset<P extends { id: string; pricing: { segment: string; experienceLevel: string } }>(personas: P[], k: number): P[];
export function shares<P extends { pricing: Record<string, any> }>(personas: P[], dim: keyof PricingBlock, filter?: (p: P) => boolean): Record<string, number>;

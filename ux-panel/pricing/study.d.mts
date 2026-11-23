import type { Design, PricingRecord, VerdictBlock } from './analysis.mjs';
import type { PricingPersona } from '../personas/pricing.mjs';
import type { Pmf } from '../lib/ssr.mjs';

export const DESIGN: Design;
export const PRICING_TOKENS: { sharedIn: number; ownIn: number; digestIn: number; out: number; callsPerPersona: number };

export interface PricingEstimate {
  survey: { calls: number; expected: number; high: number };
  handsOn: { sessions: number; weekReviews: number; steps: { expected: number; max: number }; expected: number; high: number } | null;
  expected: number;
  high: number;
}
export function estimatePricingCost(args: { n: number; handsOnPersonas?: Array<Record<string, any>>; model: string; tokens?: typeof PRICING_TOKENS }): PricingEstimate;
export function formatPricingEstimate(e: PricingEstimate, opts: { model: string; n: number; handsOn: number }): string;

type Llm = { call(params: any): Promise<any>; [k: string]: any };
type Score = (text: string, questionId: string) => Promise<{ pmf: Pmf; sharp: Pmf }>;
export function askBlock(args: { llm: Llm; tool: any; persona: PricingPersona; tour: { blocks: any[] }; question: string; digest?: string }): Promise<Record<string, any>>;
export function scoreVerdicts(entries: Array<[string | number, { answer?: string; why?: string } | string | undefined]>, qid: string, score: Score): Promise<Required<Pick<VerdictBlock, 'answers' | 'why' | 'scores' | 'sharp' | 'stance' | 'yes'>>>;
export function surveyPersona(args: { llm: Llm; persona: PricingPersona; tour: { blocks: any[] }; seed: string | number; tier?: string; digest?: string; score: Score; nearestLabel: (text: string) => Promise<string> }): Promise<PricingRecord>;
export function handsOnDigest(run: Record<string, any>, personaId: string): string;
export function runPricingStudy(opts: Record<string, any>): Promise<any>;

import type { Pmf } from '../lib/ssr.mjs';

/** One block of would-buy answers, keyed by price / multiple / variant id. */
export interface VerdictBlock {
  answers?: Record<string, string>;
  why?: Record<string, string>;
  scores?: Record<string, Pmf>;
  sharp?: Record<string, Pmf>;
  stance?: Record<string, 'yes' | 'no' | 'maybe' | null>;
  yes?: Record<string, boolean>;
  [k: string]: unknown;
}
export interface VwAnswer { answers?: Record<string, string>; tooCheap: number | null; cheap: number | null; expensive: number | null; tooExpensive: number | null; valid?: boolean; [k: string]: unknown }
export interface PricingRecord {
  personaId: string;
  tier?: 'survey' | 'hands-on' | string;
  segment: string;
  experience: string;
  vw: VwAnswer;
  gg: VerdictBlock & { order?: number[] };
  annual: VerdictBlock & { offers: Array<{ multiple: number; price: number }> };
  lifetime: VerdictBlock;
  packages: VerdictBlock & { choice?: string | null; choiceText?: string; ranking?: string[]; oneThing?: string; oneThingLabel?: string | null };
  acceptableMonthly?: number;
  acceptableSource?: string;
  [k: string]: unknown;
}
export interface Package { id: string; name: string; price: number; features: string[]; adds: string | null }
export interface Design { ggPrices: number[]; annualMultiples: number[]; lifetimePrices: number[]; packages: Package[]; features: string[] }

export interface VwResult { n: number; dropped: number; pmc: number | null; opp: number | null; ipp: number | null; pme: number | null; medians?: { tooCheap: number | null; cheap: number | null; expensive: number | null; tooExpensive: number | null } }
export interface CurveRow { price: number; n: number; take: number; takeSharp: number; yesShare: number; revenuePer100: number; index: number }
export interface AnnualRow { multiple: number; n: number; meanPrice: number; take: number; yesShare: number }
export interface PackageSummary { n: number; shares: Record<string, number>; take: Record<string, number>; yesShare: Record<string, number> }
export interface Tipping { noOnBase: number; firmNoOnBase: number; maybeOnBase: number; byVariant: Array<[string, number]>; oneThing: Array<[string, number]> }
export interface GroupAnalysis { label: string; kind: 'all' | 'segment' | 'experience'; n: number; vw: VwResult; gg: CurveRow[]; annual: AnnualRow[]; lifetime: CurveRow[]; packages: PackageSummary; acceptableMedian: number | null }
export interface Recommendation { price: number | null; priceRunnerUp: number | null; inRange: boolean | null; package: string | null; packageRunnerUp: string | null; worstSegment: string | null; summary: string }
export interface StanceAgreement { n: number; agree: number; rate: number; unclear: number }
export interface Analysis { n: number; groups: Record<string, GroupAnalysis>; tipping: Tipping; features: Array<{ feature: string; score: number; n: number }>; stanceAgreement: StanceAgreement; recommendation: Recommendation }

export function take(pmf: Pmf | undefined): number;
export function saidYes(sharpPmf: Pmf | undefined): boolean;
export function yesOf(block: VerdictBlock | undefined, key: string | number): boolean | null;
export function groupings(records: PricingRecord[]): Array<{ id: string; label: string; kind?: string; filter: (r: PricingRecord) => boolean }>;
export function vanWestendorp(rows: VwAnswer[], opts?: { minN?: number; step?: number }): VwResult;
export function takeCurve(records: PricingRecord[], block: 'gg' | 'lifetime' | string, prices: number[]): CurveRow[];
export function annualCurve(records: PricingRecord[], multiples: number[]): AnnualRow[];
export function acceptableMonthly(yesByPrice: Record<string, boolean> | undefined, prices: number[]): number | null;
export function packageSummary(records: PricingRecord[], packages: Package[]): PackageSummary;
export function tippingFeatures(records: PricingRecord[], packages: Package[]): Tipping;
export function stanceAgreement(records: PricingRecord[], blocks?: string[]): StanceAgreement;
export function featureRanking(records: PricingRecord[], features: string[]): Array<{ feature: string; score: number; n: number }>;
export function analyse(records: PricingRecord[], design: Design): Analysis;
export function recommend(groups: Record<string, GroupAnalysis>, design: Design, tipping?: Tipping | null): Recommendation;
export function compareTiers(survey: Analysis, handsOn: Analysis): { priceOrder: number | null; packageOrder: number | null; samePrice: boolean; samePackage: boolean };

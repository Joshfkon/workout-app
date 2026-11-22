export type Pmf = number[];
export interface SsrOptions { epsilon?: number; temperature?: number }
export const LIKERT_POINTS: number[];
export function cosine(a: number[], b: number[]): number;
export function normalise(weights: number[]): number[];
export function pmfFromSimilarities(sims: number[], opts?: SsrOptions): Pmf;
export function ssrPmf(responseVec: number[], anchorSetVecs: number[][][], opts?: SsrOptions): Pmf;
export function meanPmf(pmfs: Pmf[]): Pmf;
export function expectedValue(pmf: Pmf): number;
export function ksSimilarity(p: Pmf, q: Pmf): number;

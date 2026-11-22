export function ranks(xs: number[]): number[];
export function spearman(xs: number[], ys: number[]): number;
export function ratingPmf(stars: number[]): number[];
export function balanceByStars<T extends { stars: number }>(reviews: T[], perStar: number): T[];
export interface CalibrationResult {
  n: number;
  spearman: number;
  byStar: { stars: number; n: number; meanScore: number | null }[];
  monotonic: boolean;
  perSet: number[];
  apps: { app: string; n: number; ks: number; predictedMean: number; actualMean: number }[];
}
export function calibrateQuestion(reviews: { stars: number; app: string; vec: number[] }[], anchorSetVecs: number[][][]): CalibrationResult;

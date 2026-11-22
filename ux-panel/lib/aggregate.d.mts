import type { Pmf } from './ssr.mjs';

export type Severity = 'minor' | 'major' | 'blocker' | string;
export interface ScoreCell { n: number; pmf: Pmf; mean: number; sd: number }
export type ScoreTable = Record<string, Record<string, ScoreCell>>;

export interface FrictionInput {
  personaId: string;
  journeyId: string;
  screen: string;
  text: string;
  severity?: Severity;
  screenshot?: string;
  taskId?: string;
  embedding: number[];
  [k: string]: unknown;
}
export interface FrictionCluster {
  screen: string;
  label: string;
  personaCount: number;
  personas: string[];
  journeys: string[];
  severity: Severity;
  screenshots: string[];
  items: Omit<FrictionInput, 'embedding'>[];
  centroid: number[];
}
export interface Completion { completed: number; gaveUp: number; ran: number; errored: number }
export interface ComparableRun { scores: Record<string, Record<string, { n: number; pmf: Pmf; mean: number }>>; frictions: Array<Pick<FrictionCluster, 'screen' | 'centroid' | 'personaCount' | 'label'> & Partial<FrictionCluster>> }
export interface RunComparison {
  scores: Record<string, Record<string, { meanA: number; meanB: number; delta: number; ks: number }>>;
  frictions: {
    persisting: Array<{ a: ComparableRun['frictions'][number]; b: ComparableRun['frictions'][number]; personaDelta: number }>;
    added: ComparableRun['frictions'];
    resolved: ComparableRun['frictions'];
  };
}

export function screenKey(urlOrPath: string): string;
export function aggregateScores(results: Array<{ journeyId: string; scores?: Record<string, Pmf> }>, questionIds: string[]): ScoreTable;
export function clusterFrictions(frictions: FrictionInput[], opts?: { threshold?: number; sameScreenOnly?: boolean }): FrictionCluster[];
export function completionRates(results: Array<{ journeyId: string; outcome?: string }>): Record<string, Completion>;
export function compareRuns(a: ComparableRun, b: ComparableRun, opts?: { threshold?: number }): RunComparison;

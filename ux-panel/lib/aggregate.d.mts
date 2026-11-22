import type { Pmf } from './ssr.mjs';

export type Severity = 'minor' | 'major' | 'blocker' | string;
export interface ScoreCell { n: number; pmf: Pmf; mean: number; sd: number; sharp?: { pmf: Pmf; mean: number } }
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
type ComparableCell = { n: number; pmf: Pmf; mean: number; sharp?: { mean: number } };
export interface ComparableRun { scores: Record<string, Record<string, ComparableCell>>; weekScores?: Record<string, Record<string, ComparableCell>> | null; frictions: Array<Pick<FrictionCluster, 'screen' | 'centroid' | 'personaCount' | 'label'> & Partial<FrictionCluster>> }
export interface ScoreDelta { meanA: number; meanB: number; delta: number; ks: number; sharpDelta: number }
export interface RunComparison {
  scores: Record<string, Record<string, ScoreDelta>>;
  weekScores: Record<string, Record<string, ScoreDelta>>;
  frictions: {
    persisting: Array<{ a: ComparableRun['frictions'][number]; b: ComparableRun['frictions'][number]; personaDelta: number }>;
    added: ComparableRun['frictions'];
    resolved: ComparableRun['frictions'];
  };
}

export function screenKey(urlOrPath: string): string;
export function aggregateScores(results: Array<{ journeyId: string; scores?: Record<string, Pmf>; scoresSharp?: Record<string, Pmf> }>, questionIds: string[]): ScoreTable;
export function runAnchorHashes(run: { anchorHashes?: Record<string, string>; anchorsHash?: string }, legacy?: Record<string, Record<string, string>>): Record<string, string>;
export function comparableQuestions(a: { embed: string; anchorHashes?: Record<string, string>; anchorsHash?: string } | null, b: { embed: string; anchorHashes?: Record<string, string>; anchorsHash?: string } | null, legacy?: Record<string, Record<string, string>>): string[];
export function compareScoreTables(ta: Record<string, Record<string, ComparableCell>> | null | undefined, tb: Record<string, Record<string, ComparableCell>> | null | undefined, questions: string[]): Record<string, Record<string, ScoreDelta>>;
export function clusterFrictions(frictions: FrictionInput[], opts?: { threshold?: number; sameScreenOnly?: boolean }): FrictionCluster[];
export function completionRates(results: Array<{ journeyId: string; outcome?: string }>): Record<string, Completion>;
export function compareRuns(a: ComparableRun, b: ComparableRun, opts?: { threshold?: number; questions?: string[] | null }): RunComparison;
export function envTaintedTasks(cluster: { items: { taskId: string }[] }, results: { taskId: string; envErrors?: string[] }[]): string[];

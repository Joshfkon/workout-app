/** A run.json object (see run.mjs). Loosely typed: the report reads what it needs. */
export type RunRecord = Record<string, any>;
export function renderReport(run: RunRecord, opts?: { baseline?: RunRecord | null; basePrefix?: string }): string;

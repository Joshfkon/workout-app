export function windowLines(lines: string[], visible: number[], limit: number): { lo: number; hi: number; extras: number[] } | null;
export function personaSystemPrompt(p: Record<string, any>, lens?: string | null): string;
export const LENSES: Record<string, { persona: string[]; review: string }>;

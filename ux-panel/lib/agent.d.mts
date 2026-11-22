export function windowLines(lines: string[], visible: number[], limit: number): { lo: number; hi: number; extras: number[] } | null;
export function personaSystemPrompt(p: Record<string, any>, lens?: string | null): string;
export const LENSES: Record<string, { persona: string[]; review: string }>;

interface ToolDef { name: string; description: string; strict: boolean; input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] } }
export const REVIEW_TOOL: ToolDef;
export const WEEK_REVIEW_TOOL: ToolDef;
export function writeWeekReview(args: {
  llm: { call(params: any): Promise<{ content: Array<Record<string, any>> }> };
  persona: Record<string, any>;
  sessions: Array<{ label: string; outcome: string; summary?: string; review?: Record<string, any> }>;
  lens?: string | null;
}): Promise<Record<string, string>>;

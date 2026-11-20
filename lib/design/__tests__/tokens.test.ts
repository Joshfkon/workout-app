/**
 * Keeps the design tokens readable and in sync with app/globals.css.
 */

import fs from 'fs';
import path from 'path';
import { DARK, LIGHT, contrastRatio, cssVarName, type ThemeTokens } from '../tokens';

const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');

/** The body of the first `selector { … }` block. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);
  return css.slice(start, css.indexOf('\n}', start));
}

function readVar(body: string, name: string): number[] | null {
  const m = body.match(new RegExp(`${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const THEMES: Array<[string, ThemeTokens, string]> = [
  ['dark', DARK, ':root'],
  ['light', LIGHT, ':root[data-theme="light"]'],
];

describe.each(THEMES)('%s theme tokens', (_name, t, selector) => {
  it('globals.css matches lib/design/tokens.ts', () => {
    const body = block(selector);
    for (const key of Object.keys(t) as Array<keyof ThemeTokens>) {
      expect({ key, value: readVar(body, cssVarName(key)) }).toEqual({ key, value: [...t[key]] });
    }
  });

  // Body text and labels (≥4.5:1) on every surface they sit on.
  const TEXT: Array<keyof ThemeTokens> = ['ink', 'ink-2', 'ink-3', 'action', 'ok', 'warn', 'bad', 'protein', 'carbs', 'fat'];
  const SURFACES: Array<keyof ThemeTokens> = ['bg', 'card'];

  it.each(TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const)))(
    '%s on %s is at least 4.5:1',
    (fg, bg) => {
      expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('primary button label is readable on the accent', () => {
    expect(contrastRatio(t['on-action'], t.action)).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary text stays readable on the fill used by chips and inputs', () => {
    expect(contrastRatio(t['ink-2'], t.fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1);
  });
});

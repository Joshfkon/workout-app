/** The polish lens adds its brief to the persona prompt; no lens leaves it unchanged. */
import { personaSystemPrompt } from '../lib/agent.mjs';

const p = { name: 'Sam', age: 27, summary: 's', goals: 'g', experience: 'intermediate', previousApps: 'Hevy', patience: 3, techComfort: 4 };

describe('personaSystemPrompt lenses', () => {
  it('adds the polish brief only with the polish lens', () => {
    expect(personaSystemPrompt(p)).not.toMatch(/polished and finished/);
    expect(personaSystemPrompt(p, 'polish')).toMatch(/polished and finished/);
    expect(personaSystemPrompt(p, 'unknown')).toBe(personaSystemPrompt(p));
  });
});

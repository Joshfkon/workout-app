/**
 * Persona user stories: designer-style scenarios written FOR one persona
 * ("Lena only has 30 minutes and always does the same lifts: story 1, start
 * today's session; story 2, swap an exercise she can't do in her garage").
 *
 * The core JOURNEYS test the same five tasks for everyone; stories test what
 * each persona would actually try. Stories are generated once and saved to
 * ux-panel/stories.json, then reused on every run, so two builds are judged on
 * identical stories. Regenerate only on purpose (--regen-stories) and compare
 * runs that used the same stories file (its hash is in the run record).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { toolUses } from './llm.mjs';
import { personaSystemPrompt } from './agent.mjs';

const STORIES_TOOL = {
  name: 'submit_stories',
  description: 'Submit the user stories.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['stories'],
    properties: {
      stories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'goal'],
          properties: {
            id: { type: 'string', description: 'kebab-case, unique for this persona' },
            title: { type: 'string', description: 'Short story title, e.g. "Swap an exercise mid-session"' },
            goal: { type: 'string', description: 'What the persona sets out to do, in their words, with enough detail to know when it is done. No UI instructions.' },
          },
        },
      },
    },
  },
};

const STORY_MAX_STEPS = 25;

export function storyToJourney(personaId, s) {
  return { id: `story:${personaId}:${s.id}`, label: s.title, account: 'returning', startPath: '/dashboard', maxSteps: STORY_MAX_STEPS, goal: () => s.goal, story: true };
}

export async function loadStories(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { personas: {} };
  }
}

/**
 * Ensure each persona has `perPersona` stories; generate missing ones.
 * Returns the (possibly updated) stories object and whether it changed.
 */
export async function ensureStories({ file, personas, llm, perPersona = 3, regenerate = false }) {
  const data = regenerate ? { personas: {} } : await loadStories(file);
  let changed = false;
  for (const p of personas) {
    if (data.personas[p.id]?.length >= perPersona) continue;
    const msg = await llm.call({
      system: [{ type: 'text', text: personaSystemPrompt(p) }],
      tools: [STORIES_TOOL],
      messages: [
        {
          role: 'user',
          content:
            `Step out of character for a moment and act as a product designer writing user stories for ${p.name}, a returning user of a workout + nutrition tracking app (logging workouts, programs/templates, nutrition, bodyweight, progress charts, settings). ` +
            `Write ${perPersona} distinct stories of things ${p.name} would realistically try in a typical week, given their situation and habits — the everyday tasks and the occasional fix-up (editing a logged set, changing a workout's exercises, adjusting a target). ` +
            'Each story is one task with a clear end. Avoid tasks that need a camera, a wearable or payment. Use submit_stories.',
        },
      ],
    });
    const use = toolUses(msg).find((u) => u.name === 'submit_stories');
    if (!use) throw new Error(`no stories for ${p.id}`);
    data.personas[p.id] = use.input.stories.slice(0, perPersona);
    changed = true;
  }
  if (changed) await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  return { data, changed };
}

/**
 * The persona agent: drives a real browser at phone width as one persona
 * through one journey, then writes that persona's free-text review.
 *
 * Each step is a FRESH request (not a growing conversation): system prompt
 * (persona, cached) + goal + the persona's own running action log + the
 * current screen (accessibility snapshot with element refs, and a
 * screenshot). That keeps per-step cost flat, avoids replaying stale
 * screens, and makes every step reproducible from the run log.
 *
 * The agent may only use what is on the screen: it gets no app documentation,
 * so getting lost is a real finding, not a prompt bug.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toolUses } from './llm.mjs';
import { QUESTIONS } from '../anchors.mjs';

const thought = {
  type: 'string',
  description: "One short sentence, in the persona's own voice, about what they're thinking right now.",
};

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });

export const STEP_TOOLS = [
  { name: 'tap', description: 'Tap an element on screen by its ref from the snapshot.', input_schema: obj({ ref: { type: 'string' }, thought }, ['ref', 'thought']) },
  {
    name: 'type',
    description: 'Tap a text field by ref, clear it, and type text. Set submit=true to press Enter afterwards.',
    input_schema: obj({ ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' }, thought }, ['ref', 'text', 'submit', 'thought']),
  },
  { name: 'select', description: 'Choose an option in a <select>/combobox by ref and visible option label.', input_schema: obj({ ref: { type: 'string' }, option: { type: 'string' }, thought }, ['ref', 'option', 'thought']) },
  { name: 'scroll', description: 'Scroll the page to see more.', input_schema: obj({ direction: { type: 'string', enum: ['up', 'down'] }, thought }, ['direction', 'thought']) },
  { name: 'back', description: 'Press the browser/OS back gesture.', input_schema: obj({ thought }, ['thought']) },
  { name: 'wait', description: 'Wait a couple of seconds for something to load.', input_schema: obj({ thought }, ['thought']) },
  {
    name: 'report_friction',
    description:
      'Note something that confused, slowed, annoyed or worried you on THIS screen (call it alongside your next action). Be concrete: what you expected vs what happened.',
    input_schema: obj(
      { description: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'blocker'] }, thought },
      ['description', 'severity', 'thought'],
    ),
  },
  {
    name: 'done',
    description: "Stop. outcome='completed' if you achieved the goal, 'gave_up' if you would close the app / ask a friend instead.",
    input_schema: obj({ outcome: { type: 'string', enum: ['completed', 'gave_up'] }, summary: { type: 'string' }, thought }, ['outcome', 'summary', 'thought']),
  },
].map((t) => ({ ...t, strict: true }));

const reviewProps = Object.fromEntries(QUESTIONS.map((q) => [q.id, { type: 'string', description: q.prompt }]));
export const REVIEW_TOOL = {
  name: 'submit_review',
  description: 'Submit your honest review of what you just did in the app, in your own words.',
  strict: true,
  input_schema: obj(
    {
      ...reviewProps,
      liked: { type: 'string', description: 'What, if anything, you liked.' },
      confusing: { type: 'string', description: 'What confused or annoyed you most.' },
      simpler: { type: 'string', description: 'How this task could have been simpler for you, concretely.' },
    },
    [...QUESTIONS.map((q) => q.id), 'liked', 'confusing', 'simpler'],
  ),
};

const LEVEL = ['', 'very low', 'low', 'average', 'high', 'very high'];

export function personaSystemPrompt(p) {
  return [
    `You are role-playing ${p.name}, ${p.age}, a real person trying the HyperTrack fitness app on an iPhone for the first time in this situation.`,
    `About you: ${p.summary}`,
    `Your goals: ${p.goals}`,
    `Training experience: ${p.experience}. Apps you've used: ${p.previousApps}.`,
    `Patience: ${LEVEL[p.patience]}. Comfort with technology: ${LEVEL[p.techComfort]}.`,
    '',
    'How to behave:',
    `- Act and think exactly as ${p.name} would. Use only what is on the screen; you have never seen documentation for this app. Do not use knowledge of how apps like this are built.`,
    "- Read the screen the way this person would. If they'd skim, skim. If jargon would lose them, it loses you.",
    '- Each turn, take ONE action with a tool. When something on this screen confuses, slows or bothers you, also call report_friction in the same turn.',
    `- If you'd realistically give up (close the app, ask someone), call done with outcome 'gave_up'. With ${LEVEL[p.patience]} patience, don't keep trying forever.`,
    '- Never type real personal data other than what the task gives you.',
  ].join('\n');
}

/** Patience scales the step budget: patience 1 → 60 %, 5 → 100 % of maxSteps. */
export function stepBudget(journey, persona) {
  return Math.max(5, Math.round(journey.maxSteps * (0.5 + persona.patience / 10)));
}

const SNAPSHOT_CHARS = 14000;

export async function observe(page) {
  const url = page.url();
  let snapshot = '';
  try {
    snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
  } catch (e) {
    snapshot = `(snapshot failed: ${e.message})`;
  }
  if (snapshot.length > SNAPSHOT_CHARS) snapshot = snapshot.slice(0, SNAPSHOT_CHARS) + '\n… (truncated)';
  const png = await page.screenshot({ type: 'jpeg', quality: 60 });
  return { url, snapshot, jpeg: png };
}

async function settle(page) {
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function act(page, name, input) {
  const loc = (ref) => page.locator(`aria-ref=${ref}`);
  switch (name) {
    case 'tap':
      await loc(input.ref).click({ timeout: 5000 });
      break;
    case 'type':
      await loc(input.ref).fill(input.text, { timeout: 5000 });
      if (input.submit) await loc(input.ref).press('Enter');
      break;
    case 'select':
      await loc(input.ref).selectOption({ label: input.option }, { timeout: 5000 });
      break;
    case 'scroll':
      await page.mouse.wheel(0, input.direction === 'down' ? 600 : -600);
      break;
    case 'back':
      await page.goBack({ timeout: 8000 }).catch(() => {});
      break;
    case 'wait':
      await page.waitForTimeout(2000);
      break;
    default:
      throw new Error(`unknown action ${name}`);
  }
  await settle(page);
}

const describe = (name, input) =>
  name === 'type' ? `typed "${input.text}" into ${input.ref}` : name === 'tap' ? `tapped ${input.ref}` : name === 'select' ? `chose "${input.option}" in ${input.ref}` : name === 'scroll' ? `scrolled ${input.direction}` : name;

/**
 * Run one persona through one journey.
 * @returns {Promise<{outcome, steps, log, frictions, finalUrl, summary}>}
 */
export async function runJourney({ page, llm, persona, journey, goalText, credentials, outDir, baseUrl }) {
  await mkdir(outDir, { recursive: true });
  const system = [{ type: 'text', text: personaSystemPrompt(persona), cache_control: { type: 'ephemeral' } }];
  const budget = stepBudget(journey, persona);
  const log = [];
  const frictions = [];
  let outcome = 'gave_up';
  let summary = `Ran out of patience after ${budget} actions.`;
  let lastError = '';

  await page.goto(new URL(journey.startPath, baseUrl).toString(), { waitUntil: 'load', timeout: 90000 });
  await settle(page);

  let step = 0;
  for (; step < budget; step++) {
    const obs = await observe(page);
    const shotPath = path.join(outDir, `step-${String(step).padStart(2, '0')}.jpg`);
    await writeFile(shotPath, obs.jpeg);
    const screen = new URL(obs.url).pathname;
    const text = [
      `YOUR TASK: ${goalText}`,
      credentials ? `Email to use: ${credentials.email}\nPassword to use: ${credentials.password}` : '',
      `Actions so far (${step}/${budget}):\n${log.length ? log.map((l) => `- [${l.screen}] ${l.action} — "${l.thought}"`).join('\n') : '- (none yet)'}`,
      lastError ? `Your last action failed: ${lastError}` : '',
      `CURRENT SCREEN: ${screen}\nAccessibility snapshot (refs are for your tools):\n${obs.snapshot}`,
      'What do you do now?',
    ]
      .filter(Boolean)
      .join('\n\n');
    const msg = await llm.call({
      system,
      tools: STEP_TOOLS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: obs.jpeg.toString('base64') } },
            { type: 'text', text },
          ],
        },
      ],
    });
    const uses = toolUses(msg);
    if (!uses.length) {
      lastError = 'You did not use a tool. Use exactly one action tool.';
      continue;
    }
    lastError = '';
    let finished = false;
    for (const u of uses) {
      if (u.name === 'report_friction') {
        frictions.push({ screen, text: u.input.description, severity: u.input.severity, thought: u.input.thought, step, screenshot: path.basename(shotPath) });
        continue;
      }
      if (u.name === 'done') {
        outcome = u.input.outcome;
        summary = u.input.summary;
        log.push({ step, screen, action: `done (${outcome})`, thought: u.input.thought });
        finished = true;
        break;
      }
      try {
        await act(page, u.name, u.input);
        log.push({ step, screen, action: describe(u.name, u.input), thought: u.input.thought });
      } catch (e) {
        lastError = `${describe(u.name, u.input)}: ${e.message.split('\n')[0]}`;
        log.push({ step, screen, action: `${describe(u.name, u.input)} (failed)`, thought: u.input.thought });
      }
      break; // one action per turn
    }
    if (finished) break;
  }
  const finalObs = await observe(page);
  await writeFile(path.join(outDir, 'final.jpg'), finalObs.jpeg);
  return { outcome, summary, steps: log.length, budget, log, frictions, finalUrl: new URL(finalObs.url).pathname };
}

/** The persona's free-text review of the journey they just did (no numbers asked). */
export async function writeReview({ llm, persona, goalText, run }) {
  const msg = await llm.call({
    system: [{ type: 'text', text: personaSystemPrompt(persona), cache_control: { type: 'ephemeral' } }],
    tools: [REVIEW_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `You just tried to: ${goalText}`,
          `How it went: ${run.outcome === 'completed' ? 'you got it done' : 'you gave up'} after ${run.steps} actions. ${run.summary}`,
          `What you did, step by step:\n${run.log.map((l) => `- [${l.screen}] ${l.action} — "${l.thought}"`).join('\n')}`,
          run.frictions.length ? `Things that bothered you along the way:\n${run.frictions.map((f) => `- [${f.screen}] ${f.text}`).join('\n')}` : '',
          'Now answer as yourself, briefly and honestly, using submit_review. Reply briefly to each question; do not give numeric ratings.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });
  const use = toolUses(msg).find((u) => u.name === 'submit_review');
  if (!use) throw new Error('persona did not submit a review');
  return use.input;
}

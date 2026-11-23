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
import { TASK_QUESTIONS, WEEK_QUESTIONS, FREE_FEATURES, PRO_FEATURES, PRO_MONTHLY_PRICE } from '../anchors.mjs';

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

const propsFor = (qs) => Object.fromEntries(qs.map((q) => [q.id, { type: 'string', description: q.prompt }]));
const reviewProps = propsFor(TASK_QUESTIONS);
/**
 * Every separate problem, small annoyances included, one per item. Live
 * report_friction calls only catch what a persona flags mid-task (mostly
 * things that block it); without this a run with no blockers reported
 * "0 issues" while every review complained about the same popup.
 */
export const PROBLEMS_SCHEMA = {
  type: 'array',
  description:
    "Each separate problem you ran into, small annoyances included, one per item. Empty if there were none. Don't repeat the same problem twice.",
  items: obj(
    {
      screen: { type: 'string', description: 'The screen path it happened on, as shown in [brackets] in your step list. Empty if unsure.' },
      text: { type: 'string', description: 'What happened vs. what you expected, in one or two sentences.' },
      severity: { type: 'string', enum: ['minor', 'major', 'blocker'] },
    },
    ['screen', 'text', 'severity'],
  ),
};

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
      problems: PROBLEMS_SCHEMA,
    },
    [...TASK_QUESTIONS.map((q) => q.id), 'liked', 'confusing', 'simpler', 'problems'],
  ),
};

/** End-of-week review: one per persona, after all of their sessions. */
export const WEEK_REVIEW_TOOL = {
  name: 'submit_week_review',
  description: 'Submit your honest end-of-week verdict on HyperTrack, in your own words.',
  strict: true,
  input_schema: obj(
    {
      // The verdict is scored on its own: a long answer full of reasons scores
      // near 3 whatever its first word says (round 1 of the week review: a
      // plain "No" scored 3.2 inside a paragraph, 1.95 on its own).
      ...Object.fromEntries(
        WEEK_QUESTIONS.flatMap((q) => [
          [q.id, { type: 'string', description: `${q.prompt.replace(/ Say what tips it either way\.| Say why\./, '').replace(/Answer honestly,.*$/, '')}Your answer in ONE short sentence, with no reasons (they go in ${q.id}_why).` }],
          [`${q.id}_why`, { type: 'string', description: 'Why, in one to three sentences: what tipped it.' }],
        ]),
      ),
      best: { type: 'string', description: 'The one thing that would most make you stay, if any.' },
      dealbreaker: { type: 'string', description: 'The one thing that would most make you leave, if any.' },
    },
    [...WEEK_QUESTIONS.flatMap((q) => [q.id, `${q.id}_why`]), 'best', 'dealbreaker'],
  ),
};

const LEVEL = ['', 'very low', 'low', 'average', 'high', 'very high'];

/**
 * Optional lenses: an extra brief layered on every persona, for a run that
 * should look at one quality in particular. The lens is recorded on the run,
 * and the report flags comparisons across different lenses.
 */
export const LENSES = {
  polish: {
    persona: [
      '',
      'Pay particular attention to how polished and finished the app feels, the way a careful user notices it:',
      '- Visual consistency: spacing, alignment, sizes, colours and type that look the same for the same kind of thing.',
      '- Rough edges: text cut off or wrapping awkwardly, overlapping elements, things that jump or flash while loading, blank or broken-looking states, placeholder or debug text.',
      '- Feedback: does every tap visibly respond, and is it clear something saved or is still loading?',
      '- Wording: clear, consistent, friendly copy, without typos, jargon or mixed terms for the same thing.',
      '- Call report_friction for these even when they do not stop you, with severity minor unless they really get in the way. Say exactly what looks off and where on the screen.',
    ],
    review:
      'Also judge polish closely: in "polish" say what felt finished and what felt rough, and list each visual, wording or feedback rough edge you noticed as its own problem.',
  },
};

export function personaSystemPrompt(p, lens = null) {
  const lensLines = lens && LENSES[lens] ? LENSES[lens].persona : [];
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
    ...lensLines,
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
  // Sheets and dialogs render at the end of the DOM, so a plain head-cut
  // snapshot hides exactly the thing on top of the screen. Put an open
  // dialog first; its refs resolve like the page's.
  let dialog = '';
  try {
    const open = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible');
    if (await open.count()) dialog = await open.last().ariaSnapshot({ mode: 'ai', timeout: 3000 });
  } catch {
    dialog = '';
  }
  if (dialog) {
    const room = Math.max(0, SNAPSHOT_CHARS - dialog.length);
    snapshot = `A sheet/dialog is open on top of the page; tap inside it (or close it) first:\n${dialog}\n\nPage behind it (covered while the sheet is open):\n${snapshot.length > room ? snapshot.slice(0, room) + '\n… (truncated)' : snapshot}`;
  } else if (snapshot.length > SNAPSHOT_CHARS) {
    snapshot = await windowAroundViewport(page, snapshot);
  }
  const png = await page.screenshot({ type: 'jpeg', quality: 60 });
  return { url, snapshot, jpeg: png };
}

/**
 * A long page's snapshot is cut around what's ON SCREEN, not from the top:
 * otherwise scrolling never changes what the persona can tap, and anything
 * below the cut (e.g. a workout's Log set button) is unreachable.
 * Exported for tests; `boxOf(ref)` resolves a ref's bounding box.
 */
export function windowLines(lines, visible, limit) {
  if (!visible.length) return null;
  const sorted = [...visible].sort((a, b) => a - b);
  // Centre on the median visible line: fixed headers and tab bars sit at the
  // far ends of the DOM and would otherwise stretch the window to the whole page.
  const centre = sorted[Math.floor(sorted.length / 2)];
  let lo = centre;
  let hi = centre;
  let size = lines[centre].length;
  for (let step = 0; lo > 0 || hi < lines.length - 1; step++) {
    const down = step % 2 === 0 ? hi < lines.length - 1 : lo === 0;
    const next = down ? hi + 1 : lo - 1;
    if (size + lines[next].length + 1 > limit) break;
    size += lines[next].length + 1;
    if (down) hi = next;
    else lo = next;
  }
  // On-screen lines outside the window (fixed bars) are kept on their own.
  const extras = sorted.filter((i) => i < lo || i > hi);
  return { lo, hi, extras };
}

async function windowAroundViewport(page, snapshot) {
  const lines = snapshot.split('\n');
  const vh = page.viewportSize()?.height ?? 844;
  const refLines = lines.map((l, i) => [i, /\[ref=(e\d+)\]/.exec(l)?.[1]]).filter(([, r]) => r);
  const boxes = await Promise.all(
    refLines.map(([, r]) => page.locator(`aria-ref=${r}`).boundingBox({ timeout: 300 }).catch(() => null)),
  );
  // On screen, and not a container taller than the screen (those are "visible" everywhere).
  const visible = refLines
    .filter((_, k) => {
      const b = boxes[k];
      return b && b.height > 0 && b.height < vh && b.y + b.height > 0 && b.y < vh;
    })
    .map(([i]) => i);
  const w = windowLines(lines, visible, SNAPSHOT_CHARS);
  if (!w) return snapshot.slice(0, SNAPSHOT_CHARS) + '\n… (truncated)';
  return [
    w.lo > 0 ? `… (${w.lo} lines above, off screen: scroll up to reach them)` : '',
    lines.slice(w.lo, w.hi + 1).join('\n'),
    w.hi < lines.length - 1 ? `… (${lines.length - 1 - w.hi} lines below, off screen: scroll down to reach them)` : '',
    w.extras.length ? `Also on screen (fixed bars):\n${w.extras.map((i) => lines[i].trim()).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function settle(page) {
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function act(page, name, input) {
  const loc = (ref) => page.locator(`aria-ref=${ref}`);
  switch (name) {
    case 'tap': {
      // A page-sized container (e.g. the document root, e1) is not a control:
      // clicking its centre hits whatever happens to be there, usually
      // nothing, and the persona then reports "my tap didn't register" as an
      // app bug. Refuse it and say why, so the next turn picks the control.
      const box = await loc(input.ref).boundingBox({ timeout: 3000 }).catch(() => null);
      const vp = page.viewportSize();
      if (box && vp && box.height >= vp.height * 0.9 && box.width >= vp.width * 0.9) {
        throw new Error(`${input.ref} is the whole page, not a button — tap the control's own ref from the list`);
      }
      await loc(input.ref).click({ timeout: 5000 });
      break;
    }
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
export async function runJourney({ page, llm, persona, journey, goalText, credentials, outDir, baseUrl, lens = null }) {
  await mkdir(outDir, { recursive: true });
  const system = [{ type: 'text', text: personaSystemPrompt(persona, lens), cache_control: { type: 'ephemeral' } }];
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
export async function writeReview({ llm, persona, goalText, run, lens = null }) {
  const msg = await llm.call({
    system: [{ type: 'text', text: personaSystemPrompt(persona, lens), cache_control: { type: 'ephemeral' } }],
    tools: [REVIEW_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `You just tried to: ${goalText}`,
          `How it went: ${run.outcome === 'completed' ? 'you got it done' : 'you gave up'} after ${run.steps} actions. ${run.summary}`,
          `What you did, step by step:\n${run.log.map((l) => `- [${l.screen}] ${l.action} — "${l.thought}"`).join('\n')}`,
          run.frictions.length ? `Things that bothered you along the way:\n${run.frictions.map((f) => `- [${f.screen}] ${f.text}`).join('\n')}` : '',
          lens && LENSES[lens] ? LENSES[lens].review : '',
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

/**
 * What the week review tells a persona about Free vs Pro. A persona seeded
 * on Pro (account.tier 'pro', see proSubscriptionRow in lib/accounts.mjs) had
 * every Pro feature unlocked all week, so they're told it was a Pro trial and
 * the pay question becomes whether they'd keep paying once it ends.
 */
export function pricingContext(persona) {
  const tiers = `Free covers ${FREE_FEATURES.join(', ').toLowerCase()}. Pro (${PRO_MONTHLY_PRICE}/month) adds ${PRO_FEATURES.join(', ').toLowerCase()}.`;
  if (persona.account?.tier === 'pro') {
    return `HyperTrack's pricing: ${tiers} You were on a Pro trial this week, so everything in Pro was unlocked for you. The trial ends now: deciding whether to pay means deciding whether you'd keep paying ${PRO_MONTHLY_PRICE}/month for what you used.`;
  }
  return `HyperTrack's pricing: ${tiers} Some of what you used this week may have been Pro features.`;
}

/**
 * The persona's end-of-week verdict, written once after all of their
 * sessions. Asked relative to what they use now, because "would you keep
 * using it?" after a single short task only ever gets an honest "maybe".
 *
 * @param {{llm, persona, sessions: Array<{label: string, outcome: string, summary?: string, review?: object}>, lens?: string|null}} args
 */
export async function writeWeekReview({ llm, persona, sessions, lens = null }) {
  const lines = sessions.map((s) => {
    const how = s.outcome === 'completed' ? 'got it done' : 'gave up';
    const notes = [s.summary, s.review?.liked && `Liked: ${s.review.liked}`, s.review?.confusing && `Bothered you: ${s.review.confusing}`].filter(Boolean).join(' ');
    return `- ${s.label}: you ${how}. ${notes}`;
  });
  const msg = await llm.call({
    system: [{ type: 'text', text: personaSystemPrompt(persona, lens), cache_control: { type: 'ephemeral' } }],
    tools: [WEEK_REVIEW_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `It's the end of your first week with HyperTrack. Over the week you used it for these things:\n${lines.join('\n')}`,
          `What you use now: ${persona.previousApps || 'nothing in particular'}. What you want: ${persona.goals}`,
          pricingContext(persona),
          "Now decide, as yourself, whether HyperTrack earns a place over what you already do. Judge it against your current way, not against perfection. If it's clearly better or clearly worse for you, say so plainly; only say you're unsure if you truly are.",
          'Answer with submit_week_review, briefly and honestly; do not give numeric ratings.',
        ].join('\n\n'),
      },
    ],
  });
  const use = toolUses(msg).find((u) => u.name === 'submit_week_review');
  if (!use) throw new Error('persona did not submit a week review');
  return use.input;
}

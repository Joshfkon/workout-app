/**
 * Journeys the persona agent attempts. Each one is phrased the way a user
 * would think about it ("log what you ate"), never as UI instructions
 * ("tap Eat, then +"): finding the way is the thing being measured.
 *
 *   account: 'fresh'     → a brand-new synthetic account; the journey begins
 *                          at /register and covers sign-up + onboarding.
 *            'returning' → an account seeded with the persona's profile and a
 *                          few weeks of history, already signed in, starting
 *                          on Home.
 *   maxSteps: hard cap on agent actions; patience lowers it further (see
 *             stepBudget in lib/agent.mjs).
 */
export const JOURNEYS = [
  {
    id: 'first-run',
    label: 'First run & onboarding',
    account: 'fresh',
    startPath: '/register',
    maxSteps: 40,
    goal: (p) =>
      `You just downloaded HyperTrack and opened it for the first time. Create an account with the email and password below and get through setup until you reach the app's main screen. Answer setup questions the way ${p.name} truly would.`,
  },
  {
    id: 'log-workout',
    label: 'Start & log a workout',
    account: 'returning',
    startPath: '/dashboard',
    maxSteps: 35,
    goal: () =>
      "You're at the gym. Start today's workout and log at least two sets of the first exercise with realistic weights and reps for you. Then you're done (you don't have to finish the whole session).",
  },
  {
    id: 'log-meal',
    label: 'Log a meal',
    account: 'returning',
    startPath: '/dashboard',
    maxSteps: 30,
    goal: () =>
      // Not "lunch": sessions run at any hour, and a task that names a meal the
      // clock disagrees with reported the app's (correct) time-of-day default
      // as a bug in every session of the first week-review baseline.
      "Log the meal you just ate (whichever meal it is right now): search for at least one food and add it, then try to add a food you've eaten recently a faster way if the app offers one. Also find where you would scan a barcode (you can't actually use the camera; just find the entry point).",
  },
  {
    id: 'check-progress',
    label: 'Check progress',
    account: 'returning',
    startPath: '/dashboard',
    maxSteps: 20,
    goal: () =>
      'Find out whether you are actually making progress: how your strength and bodyweight have moved over the last few weeks. Stop when you feel you have an answer (or that the app cannot tell you).',
  },
  {
    id: 'find-setting',
    label: 'Find a setting',
    account: 'returning',
    startPath: '/dashboard',
    maxSteps: 15,
    goal: (p) =>
      `Change the app's weight units to ${p.account?.units === 'kg' ? 'pounds (lb)' : 'kilograms (kg)'}. Stop once it's changed.`,
  },
];

export function journeyById(id) {
  const j = JOURNEYS.find((x) => x.id === id);
  if (!j) throw new Error(`Unknown journey "${id}". Known: ${JOURNEYS.map((x) => x.id).join(', ')}`);
  return j;
}

/**
 * Persona sampler for the pricing study (ux-panel/PRICING_STUDY.md §1).
 *
 * Draws N personas (default 100) that match the quota table below, seeded so
 * the same --seed always gives the same panel. Nothing here calls
 * Math.random: every draw comes from `rng(seed)`.
 *
 * Quota sampling, not independent draws: each dimension's counts are fixed
 * by largest-remainder allocation within its stratum (overall, or per
 * segment for gender/age/current app), then shuffled onto personas with the
 * seeded RNG. So a 100-sample hits each quota to within rounding, and the
 * dimensions are crossed at random rather than in lockstep.
 *
 * Each persona has the SAME shape as personas.json (id, name, age, summary,
 * goals, experience, patience, techComfort, previousApps, account, skip,
 * journeys), so the agent prompts and the hands-on journeys reuse it as-is,
 * plus a `pricing` block: the quota cells it was drawn from, its current
 * monthly spend, and a concrete typical week (what it logs, which features
 * it touches). Usage history is in because personas alone mis-rank features
 * (PRICING_STUDY.md, "Why relative").
 */

// ---------------------------------------------------------------------------
// QUOTAS: edit here. Weights need not sum to 1 (they are normalised).
// "Basis" is PRICING_STUDY.md §1; rows marked ASSUMPTION have no source.
// ---------------------------------------------------------------------------
export const QUOTAS = {
  // Weak: YouGov 2024 (35% track exercise, 27% diet); no published overlap.
  segment: { lifting: 0.45, 'food-only': 0.3, both: 0.25 },
  gender: {
    lifting: { male: 0.8, female: 0.2 }, // arXiv 2026, n≈15k lifting-app users
    'food-only': { female: 0.7, male: 0.3 }, // MyFitnessPal users 2014–17 (old)
    both: { male: 0.55, female: 0.45 }, // ASSUMPTION: between the two
  },
  age: {
    lifting: { '18-24': 0.2, '25-39': 0.5, '40-54': 0.22, '55+': 0.08 }, // median 34 (arXiv 2026)
    'food-only': { '18-29': 0.25, '30-49': 0.45, '50+': 0.3 }, // mean 38.7 (old)
    both: { '18-24': 0.2, '25-39': 0.5, '40-54': 0.22, '55+': 0.08 }, // ASSUMPTION: as lifting
  },
  income: { '<50k': 0.25, '50-100k': 0.35, '>100k': 0.4 }, // direction only (Pew, HINTS 2025)
  experience: { beginner: 0.35, intermediate: 0.45, advanced: 0.2 }, // ASSUMPTION: no source
  // ASSUMPTION: what they use now. Keys are '+'-joined app ids (APPS below).
  currentApp: {
    lifting: { hevy: 0.35, strong: 0.15, notes: 0.3, none: 0.2 },
    'food-only': { myfitnesspal: 0.5, macrofactor: 0.15, notes: 0.1, none: 0.25 },
    both: { 'hevy+myfitnesspal': 0.3, 'strong+myfitnesspal': 0.1, 'hevy+macrofactor': 0.1, myfitnesspal: 0.15, macrofactor: 0.1, notes: 0.1, none: 0.15 },
  },
};

/** Age bands → inclusive age ranges. */
export const AGE_RANGES = { '18-24': [18, 24], '25-39': [25, 39], '40-54': [40, 54], '55+': [55, 68], '18-29': [18, 29], '30-49': [30, 49], '50+': [50, 70] };

/**
 * ASSUMPTION: what each app costs and how many of its users pay.
 * `paidShare` of a free-tier app's users are on its paid plan; MacroFactor has
 * no free tier. Prices are the competitor list in PRICING_STUDY.md §2.
 */
export const APPS = {
  hevy: { name: 'Hevy', paidMonthly: 2.99, paidShare: 0.25, paidName: 'Hevy Pro', kind: 'lifting' },
  strong: { name: 'Strong', paidMonthly: 4.99, paidShare: 0.25, paidName: 'Strong Pro', kind: 'lifting' },
  myfitnesspal: { name: 'MyFitnessPal', paidMonthly: 19.99, paidShare: 0.2, paidName: 'MyFitnessPal Premium', kind: 'food' },
  macrofactor: { name: 'MacroFactor', paidMonthly: 11.99, paidShare: 1, paidName: 'MacroFactor', kind: 'food' },
  notes: { name: 'Notes app / paper', paidMonthly: 0, paidShare: 0, kind: 'any' },
  none: { name: 'nothing', paidMonthly: 0, paidShare: 0, kind: 'any' },
};

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

/** mulberry32 over a 32-bit hash of the seed: fast, seedable, reproducible. */
export function rng(seed) {
  let a = hash32(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

function hash32(s) {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Largest-remainder allocation of n slots over weighted keys; ties go to the
 * earlier key, so it is deterministic. Returns {key: count}, summing to n.
 */
export function allocate(n, weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  const exact = keys.map((k) => (n * weights[k]) / total);
  const counts = exact.map(Math.floor);
  let left = n - counts.reduce((s, c) => s + c, 0);
  const order = keys.map((_, i) => i).sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b);
  for (let i = 0; left > 0; i++, left--) counts[order[i % order.length]] += 1;
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

/** Fixed counts from `allocate`, shuffled into a list of n values. */
function quotaList(r, n, weights) {
  const counts = allocate(n, weights);
  return r.shuffle(Object.entries(counts).flatMap(([k, c]) => Array(c).fill(k)));
}

// ---------------------------------------------------------------------------
// Background material
// ---------------------------------------------------------------------------

const NAMES = {
  male: ['Marcus', 'Tyler', 'Jordan', 'Chris', 'Andre', 'Kevin', 'Luis', 'Brandon', 'Ethan', 'Malik', 'Ryan', 'Derek', 'Jason', 'Nate', 'Carlos', 'Sean', 'Trevor', 'Aaron', 'Hector', 'Ben', 'Daniel', 'Isaiah', 'Kyle', 'Raj', 'Paul', 'Greg', 'Victor', 'Owen', 'Terrence', 'Wes', 'Miguel', 'Josh', 'Danny', 'Elijah', 'Hank', 'Sam', 'Colin', 'DeShawn', 'Mark', 'Tom'],
  female: ['Jess', 'Ashley', 'Maria', 'Keisha', 'Lauren', 'Priya', 'Nicole', 'Hannah', 'Rachel', 'Tanya', 'Megan', 'Sofia', 'Kim', 'Brianna', 'Dana', 'Erin', 'Gabriela', 'Leah', 'Monica', 'Amanda', 'Christine', 'Tasha', 'Jenna', 'Olivia', 'Carmen', 'Linda', 'Rosa', 'Mei', 'Abby', 'Kristen', 'Deb', 'Alyssa', 'Nadia', 'Paige', 'Renee', 'Sarah', 'Val', 'Whitney', 'Yolanda', 'Zoe'],
};

const JOBS = {
  '<50k': ['retail shift lead', 'grad student', 'barista', 'home health aide', 'warehouse associate', 'part-time bookkeeper', 'line cook', 'community-college student', 'rideshare driver', 'daycare teacher'],
  '50-100k': ['high-school teacher', 'electrician', 'nurse', 'insurance claims adjuster', 'police officer', 'marketing coordinator', 'HVAC technician', 'dental hygienist', 'logistics planner', 'paralegal'],
  '>100k': ['software engineer', 'physician assistant', 'sales manager', 'pharmacist', 'small-business owner', 'product manager', 'financial analyst', 'attorney', 'engineering manager', 'anesthesiology resident'],
};

const INCOME_LINE = {
  '<50k': 'Money is tight-ish; every subscription gets questioned.',
  '50-100k': 'Comfortable but careful with recurring charges.',
  '>100k': "Doesn't sweat a few dollars a month if something earns its keep.",
};

const LEVEL_TEXT = { beginner: 'novice', intermediate: 'intermediate', advanced: 'advanced' };
const FOOD_ONLY_EXPERIENCE = { beginner: 'none', intermediate: 'novice', advanced: 'intermediate (lapsed)' };
const money = (x) => (x > 0 ? `$${x.toFixed(2)}` : '$0');

/** What each (segment, experience) typically does in a week. `d` = seeded draws. */
function weekFor(seg, exp, apps, d) {
  const lifter = seg !== 'food-only';
  const eater = seg !== 'lifting';
  const liftApp = apps.find((a) => APPS[a].kind === 'lifting');
  const foodApp = apps.find((a) => APPS[a].kind === 'food');
  const anyApp = apps.find((a) => APPS[a].kind === 'any');
  const where = (app) => (app ? (app === 'none' ? 'in their head' : `in ${APPS[app].name}`) : anyApp === 'notes' ? 'in a notes app' : 'nowhere, from memory');
  const lines = [];
  const features = [];
  if (lifter) {
    if (exp === 'beginner') {
      const days = d.pick([2, 3, 3]);
      lines.push(`Lifted ${days} times on a full-body routine from YouTube (5 machines/dumbbell moves, 3 sets each, about 45 minutes); wrote weights and reps ${where(liftApp)} and checked last week's numbers before each exercise.`);
      features.push('workout logging', 'exercise history', 'rest timer', 'weight suggestions');
    } else if (exp === 'intermediate') {
      const split = d.pick(['upper/lower', 'push/pull/legs', 'full-body', 'upper/lower']);
      const days = split === 'push/pull/legs' ? d.pick([3, 6]) : 4;
      lines.push(`Ran a ${split} split ${days} days (about ${d.int(16, 22)} working sets a session); logged every set ${where(liftApp)}, added weight or a rep when last week's sets felt easy, and looked at a bench/squat trend once.`);
      features.push('workout logging', 'exercise history', 'weight suggestions', 'progress charts', 'templates');
    } else {
      const split = d.pick(['body-part', 'push/pull/legs', 'upper/lower']);
      lines.push(`Ran week ${d.int(2, 5)} of a self-written ${split} block (${d.pick([5, 6])} sessions, RIR on every set); logged ${where(liftApp)}, tallied weekly sets per muscle in a spreadsheet, and planned the next deload.`);
      features.push('workout logging', 'program builder', 'volume per muscle (MEV/MRV)', 'deload planning', 'advanced analytics', 'e1RM trends');
    }
  }
  if (eater) {
    const daysLogged = d.int(4, 7);
    if (foodApp) {
      lines.push(`Logged food ${daysLogged} of 7 days ${where(foodApp)} (barcode scans for packaged stuff, saved meals for breakfast), aiming at a calorie and protein target; weighed in ${d.int(2, 7)} times.`);
    } else {
      lines.push(`Tracked food loosely ${daysLogged} of 7 days ${anyApp === 'notes' ? 'in a notes app (rough calories and protein)' : 'by eyeballing portions'}; weighed in ${d.int(1, 4)} times.`);
    }
    features.push('food logging', 'barcode scan', 'recent foods', 'calorie/macro targets', 'bodyweight trend');
    if (d.chance(0.5)) features.push('AI food logging (describe or photo)');
    if (d.chance(0.4)) features.push('weekly calorie-target check-ins');
  } else if (d.chance(0.4)) {
    lines.push(`Weighed in ${d.int(1, 3)} times; doesn't log food.`);
    features.push('bodyweight trend');
  }
  if (!lifter) lines.push(d.pick(['Walks most days and does a Saturday class; never logs workouts.', 'Does home cardio videos; has no interest in logging lifts.', "Plays pickleball twice a week; workouts aren't something they track."]));
  return { lines, features: [...new Set(features)] };
}

function goalsFor(seg, exp, goal) {
  const body = { cut: 'lose fat without losing muscle', bulk: 'put on size', maintenance: 'stay lean and keep getting stronger' }[goal];
  if (seg === 'food-only') return `${body === 'put on size' ? 'Gain weight cleanly' : 'Lose 10–25 lb and keep it off'}; hit a calorie and protein target without spending ten minutes a day logging.`;
  if (exp === 'beginner') return `Learn what to do in the gym and see steady progress; ${body}.`;
  if (exp === 'intermediate') return `Keep adding weight to the main lifts; ${body}${seg === 'both' ? ', with food and training in one place' : ''}.`;
  return `Run well-structured hypertrophy blocks with the right volume per muscle; ${body}${seg === 'both' ? ' with macros dialled in' : ''}.`;
}

const describeApps = (apps) => apps.map((a) => APPS[a].name).join(' + ');

/**
 * Sample N pricing personas.
 * @param {{n?: number, seed?: number|string, quotas?: typeof QUOTAS}} [opts]
 */
export function samplePricingPersonas({ n = 100, seed = 1, quotas = QUOTAS } = {}) {
  const r = rng(`pricing-personas:${seed}`);
  const segments = quotaList(r, n, quotas.segment);
  const income = quotaList(r, n, quotas.income);
  const experience = quotaList(r, n, quotas.experience);
  // Per-segment dimensions: allocate within each segment, then hand out in order.
  const perSeg = {};
  for (const seg of Object.keys(quotas.segment)) {
    const m = segments.filter((s) => s === seg).length;
    perSeg[seg] = { gender: quotaList(r, m, quotas.gender[seg]), age: quotaList(r, m, quotas.age[seg]), app: quotaList(r, m, quotas.currentApp[seg]), i: 0 };
  }
  const usedNames = new Set();
  const personas = [];
  for (let k = 0; k < n; k++) {
    const seg = segments[k];
    const s = perSeg[seg];
    const gender = s.gender[s.i];
    const ageBand = s.age[s.i];
    const appKey = s.app[s.i];
    s.i += 1;
    const exp = experience[k];
    const inc = income[k];
    const d = rng(`pricing-persona:${seed}:${k}`); // per-persona draws: editing one persona's text never shifts another's
    const [lo, hi] = AGE_RANGES[ageBand];
    const age = d.int(lo, hi);
    let name = d.pick(NAMES[gender]);
    for (let t = 0; usedNames.has(name) && t < 20; t++) name = d.pick(NAMES[gender]);
    usedNames.add(name);
    const apps = appKey.split('+');
    const paying = apps.filter((a) => APPS[a].paidMonthly > 0 && d.chance(APPS[a].paidShare));
    const monthlySpend = +paying.reduce((x, a) => x + APPS[a].paidMonthly, 0).toFixed(2);
    const goal = seg === 'food-only' ? (d.chance(0.75) ? 'cut' : 'maintenance') : d.pick(['bulk', 'maintenance', 'cut']);
    const week = weekFor(seg, exp, apps, d);
    const job = d.pick(JOBS[inc]);
    const units = d.chance(0.9) ? 'lb' : 'kg';
    const male = gender === 'male';
    const weightKg = Math.round(male ? d.int(72, 98) : d.int(56, 82));
    const heightCm = male ? d.int(170, 190) : d.int(155, 175);
    const spendLine = monthlySpend > 0 ? `Pays $${monthlySpend.toFixed(2)}/month for fitness apps today (${paying.map((a) => APPS[a].paidName).join(' + ')}).` : `Pays $0/month for fitness apps today${apps.some((a) => APPS[a].paidMonthly > 0) ? ' (free tier)' : ''}.`;
    const trainingLine =
      seg === 'food-only'
        ? { beginner: "Doesn't lift; uses an app for food, not workouts.", intermediate: 'Does casual workouts but never logs them; the app is for food.', advanced: 'Lifted seriously years ago; these days the app is for food, not workouts.' }[exp]
        : { beginner: 'Started lifting within the last year and still looks up how to do half the exercises.', intermediate: `Has lifted consistently for ${d.int(2, 5)} years.`, advanced: `Has trained seriously for ${d.int(6, 14)} years and programs their own blocks.` }[exp];
    const summary = `${age}-year-old ${job}. ${trainingLine} Uses ${describeApps(apps)} now. ${spendLine} ${INCOME_LINE[inc]}`;
    const history = seg === 'food-only' ? 'food-only' : exp === 'beginner' ? 'light' : exp === 'advanced' ? 'high' : 'regular';
    personas.push({
      id: `pr${String(k + 1).padStart(3, '0')}-${seg}-${name.toLowerCase()}`,
      name,
      age,
      summary,
      goals: goalsFor(seg, exp, goal),
      // A food-only persona's training experience is what they once did, not what they log.
      experience: seg === 'food-only' ? FOOD_ONLY_EXPERIENCE[exp] : LEVEL_TEXT[exp],
      patience: d.int(2, 4),
      techComfort: age < 35 ? d.int(3, 5) : age < 55 ? d.int(2, 4) : d.int(1, 3),
      previousApps: `${describeApps(apps)}${monthlySpend > 0 ? ` (paid, $${monthlySpend.toFixed(2)}/month)` : apps.some((a) => APPS[a].paidMonthly > 0) ? ' (free version)' : ''}`,
      account: {
        goal,
        experience: exp === 'beginner' || seg === 'food-only' ? 'novice' : exp,
        units,
        sex: gender,
        weightKg,
        heightCm,
        birthYear: 2026 - age,
        history,
        ...(exp === 'advanced' && seg !== 'food-only' ? { split: d.pick(['bodypart', 'ppl']) } : {}),
      },
      ...(seg === 'food-only' ? { skip: ['log-workout'] } : {}),
      ...(exp === 'advanced' && seg !== 'food-only' ? { journeys: ['plan-training'] } : {}),
      pricing: {
        segment: seg,
        gender,
        ageBand,
        income: inc,
        experienceLevel: exp,
        currentApp: appKey,
        currentApps: apps.map((a) => APPS[a].name),
        monthlySpend,
        spendLine: `You pay ${money(monthlySpend)} a month for fitness apps today.`,
        typicalWeek: week.lines,
        featuresTouched: week.features,
      },
    });
  }
  return personas;
}

/**
 * A quota-balanced subset of k personas for the hands-on tier: round-robin
 * over segment × experience cells (largest cells first), taking each cell's
 * personas in sample order. Deterministic given the panel.
 */
export function quotaBalancedSubset(personas, k) {
  const cells = new Map();
  for (const p of personas) {
    const key = `${p.pricing.segment}|${p.pricing.experienceLevel}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  // Allocate k across cells in proportion to their size, then fill.
  const sizes = Object.fromEntries([...cells].map(([key, ps]) => [key, ps.length]));
  const counts = allocate(Math.min(k, personas.length), sizes);
  const picked = new Set();
  for (const [key, c] of Object.entries(counts)) for (const p of cells.get(key).slice(0, c)) picked.add(p.id);
  return personas.filter((p) => picked.has(p.id));
}

/** Observed share of each value of a pricing dimension (for tests and the report). */
export function shares(personas, dim, filter = () => true) {
  const ps = personas.filter(filter);
  const out = {};
  for (const p of ps) out[p.pricing[dim]] = (out[p.pricing[dim]] ?? 0) + 1 / ps.length;
  return out;
}

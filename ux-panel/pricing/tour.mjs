/**
 * The pricing tour: the static stimulus every survey persona reads instead
 * of browsing (PRICING_STUDY.md §2, tier A). An ordered list of screens of
 * the CURRENT build, each with a screenshot and a one-line caption.
 *
 * Screenshots come from `node ux-panel/pricing/capture-tour.mjs` (local
 * build only), which also writes `tour/tour.json` with the key visible text
 * of each screen. When the images exist they go to the model as images (the
 * agent already sends screenshots); without them the persona gets the
 * captions plus key visible text, and the run records which it was.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOUR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tour');

/**
 * `fallbackText` is what the screen shows, written by hand from the build, for
 * runs without a capture. A capture's own visible text replaces it.
 */
export const TOUR = [
  {
    id: 'home',
    title: 'Home',
    path: '/dashboard',
    image: 'tour/01-home.jpg',
    caption: "Home: what to do next (log a meal, calories and protein left today), start today's workout, and quick logging.",
    fallbackText: "Today: next workout from your plan with a Start button; calories and protein left today; bodyweight trend; this week's sessions.",
  },
  {
    id: 'workout',
    title: 'A logged workout',
    path: '/dashboard/workout/:id',
    image: 'tour/02-workout.jpg',
    caption: 'A workout: the app suggests the weight and reps for each set and says why ("Last time 135 lbs × 10, 2 reps left → one weight step up").',
    fallbackText: 'Exercise card with sets; each set has weight, reps and a reps-left (RIR) chip. A strip above the next set shows the suggested weight × reps and the reason, with a "Why this weight?" link.',
  },
  {
    id: 'eat',
    title: 'Eat',
    path: '/dashboard/nutrition',
    image: 'tour/03-eat.jpg',
    caption: 'Eat: calories and macros left today; add food by describing it, scanning, searching, or from foods you log most.',
    fallbackText: 'Calories and protein/carbs/fat left today; meals by time of day with Add food; search, recent foods, barcode scan.',
  },
  {
    id: 'progress',
    title: 'Progress',
    path: '/dashboard/analytics',
    image: 'tour/04-progress.jpg',
    caption: 'Progress: are you progressing (bodyweight trend, which lifts are going up), and weekly sets per muscle vs MEV–MRV.',
    fallbackText: 'Strength trend per lift (estimated 1-rep max), bodyweight trend line, weekly sets per muscle.',
  },
  {
    id: 'builder',
    title: 'Program builder',
    path: '/dashboard/mesocycle/new',
    image: 'tour/05-builder.jpg',
    caption: 'Program builder (Pro): set up a 4–8 week training block from your profile, schedule and recovery, with planned volume and deloads.',
    fallbackText: 'Choose split, days per week and block length; the plan lists exercises per day, weekly sets per muscle against MEV/MRV, and when the deload falls.',
  },
  {
    id: 'settings',
    title: 'Settings',
    path: '/dashboard/settings',
    image: 'tour/06-settings.jpg',
    caption: 'Settings: profile, training preferences, units (lb/kg), appearance and account.',
    fallbackText: 'Units lb/kg, goal and targets, gym equipment, subscription.',
  },
];

/** Captured visible text per screen (tour/tour.json from capture-tour.mjs), if any. */
export function loadCapture(dir = TOUR_DIR) {
  const file = path.join(dir, 'tour.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The tour as message content blocks. Images when every screenshot exists
 * (mode 'images'), otherwise captions plus key visible text ('text').
 * @returns {{mode: 'images'|'text', blocks: Array<object>}}
 */
export function tourBlocks({ dir = TOUR_DIR, preferImages = true } = {}) {
  const capture = loadCapture(dir);
  const files = TOUR.map((s) => path.join(dir, path.basename(s.image)));
  const haveImages = preferImages && files.every((f) => existsSync(f));
  const blocks = [{ type: 'text', text: 'A short tour of the HyperTrack app as it is today (iPhone screens, in order):' }];
  TOUR.forEach((s, i) => {
    const visible = capture?.screens?.[s.id]?.text || s.fallbackText;
    if (haveImages) {
      blocks.push({ type: 'text', text: `${i + 1}. ${s.title}: ${s.caption}` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(files[i]).toString('base64') } });
    } else {
      blocks.push({ type: 'text', text: `${i + 1}. ${s.title}: ${s.caption}\n   On screen: ${visible}` });
    }
  });
  return { mode: haveImages ? 'images' : 'text', blocks };
}

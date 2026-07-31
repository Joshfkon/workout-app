/**
 * Motion-feature import guard (architectural constraint, enforced — not a
 * convention). Motion capture is a PARALLEL TELEMETRY STREAM: display-only
 * in v1. No module in the feature may touch the e1RM module, the
 * prescription engine, or the volume model — in either direction.
 *
 * Same enforcement style as services/__tests__/bandSourceImportGuard.test.ts:
 * walk the feature's source files and fail on any banned reference.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Every directory that belongs to the motion-capture feature. */
const FEATURE_DIRS = [
  'services/shared/motion',
  'lib/motion',
  'components/motion',
  'app/(dashboard)/dashboard/motion',
];

/**
 * Banned module references: the canonical e1RM estimator, everything on the
 * prescription path, and the volume model.
 */
const BANNED_IMPORT = new RegExp(
  [
    'services\\/shared\\/e1rm',
    'services\\/setRecommender',
    'services\\/setPrescription',
    'services\\/suggestionEngine',
    'services\\/progressionEngine',
    'services\\/weeklyProgressionEngine',
    'services\\/volumeTracker',
    'services\\/volumeBands',
    'services\\/effectiveVolume',
    'hooks\\/useWeeklyVolume',
    'hooks\\/useAdaptiveVolume',
  ].join('|')
);

/** The pure signal layer must additionally be DOM/sensor-free. Matches API
 *  usage (`window.` / `navigator[`), not prose like "bias window". */
const BANNED_DOM = /\b(window|document|navigator|localStorage|sessionStorage)\s*[.[]|\bDeviceMotionEvent\b/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

it('no motion-feature module imports e1RM, the prescription engine, or the volume model', () => {
  const offenders: string[] = [];
  for (const dir of FEATURE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      if (BANNED_IMPORT.test(src)) offenders.push(path.relative(ROOT, file));
    }
  }
  expect(offenders).toEqual([]);
});

/**
 * The phone is held to the machine by a neodymium magnet, which saturates
 * the magnetometer — any magnetometer-fused orientation source is unusable.
 * The feature must consume devicemotion ONLY (accelerationIncludingGravity
 * + rotationRate); orientation/compass APIs are banned outright.
 */
const BANNED_SENSOR_APIS =
  /deviceorientation|webkitCompassHeading|Magnetometer|OrientationSensor|compassHeading/i;

it('no motion-feature module touches magnetometer-fused orientation APIs', () => {
  const offenders: string[] = [];
  for (const dir of FEATURE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (file === __filename) continue; // this guard names the banned APIs
      const src = fs.readFileSync(file, 'utf8');
      if (BANNED_SENSOR_APIS.test(src)) offenders.push(path.relative(ROOT, file));
    }
  }
  expect(offenders).toEqual([]);
});

it('the pure signal layer (services/shared/motion) is DOM- and sensor-free', () => {
  const offenders: string[] = [];
  for (const file of walk(path.join(ROOT, 'services/shared/motion'))) {
    if (/__tests__/.test(file)) continue; // tests may reference whatever they need
    const src = fs.readFileSync(file, 'utf8');
    if (BANNED_DOM.test(src)) offenders.push(path.relative(ROOT, file));
  }
  expect(offenders).toEqual([]);
});

it('the feature directories actually exist (guard cannot rot into a no-op)', () => {
  expect(fs.existsSync(path.join(ROOT, 'services/shared/motion'))).toBe(true);
});

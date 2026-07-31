#!/usr/bin/env node
/**
 * Generates the hand-held bicep-curl capture fixture for the motion
 * acceptance test:
 *   services/shared/motion/__tests__/fixtures/handheld-curl-sweep.csv
 *
 * NOTE: the checked-in fixture is now the REAL on-device capture (added
 * 2026-07-31) — running this script would OVERWRITE it with a synthetic
 * stand-in. Kept only for generating synthetic variants when experimenting;
 * do not regenerate the acceptance fixture with it.
 *
 * Deterministic (seeded LCG). Same CSV schema the app exports (lib/motion/csv.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'services/shared/motion/__tests__/fixtures');
const G = 9.80665;
const DEG = Math.PI / 180;

// --- Ground truth (from the acceptance spec) -------------------------------
const REPS = [
  { peak: 1.51, concT: 1.5, romDeg: 72.4, eccT: 1.7 },
  { peak: 1.43, concT: 1.22, romDeg: 64.3, eccT: 1.55 },
  { peak: 2.01, concT: 1.15, romDeg: 69.3, eccT: 1.45 },
  { peak: 1.9, concT: 1.38, romDeg: 70.5, eccT: 1.6 },
];
const N_SAMPLES = 1437;
const FS = 59.99;
const DT = 1000 / FS; // ms

// Rotation axis (phone frame) and initial gravity direction — a hand-held
// curl: axis mostly horizontal, gravity mostly through the screen.
const AXIS = normalize({ x: 0.88, y: 0.28, z: 0.38 });
const G0 = normalize({ x: 0.15, y: -0.25, z: -0.95 });

// Deterministic noise.
let seed = 20260731;
function rnd() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 0xffffffff - 0.5;
}

function normalize(v) {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function add(...vs) {
  return vs.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
}
function rotate(v, n, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const nxv = cross(n, v);
  const nd = n.x * v.x + n.y * v.y + n.z * v.z;
  return {
    x: v.x * c + nxv.x * s + n.x * nd * (1 - c),
    y: v.y * c + nxv.y * s + n.y * nd * (1 - c),
    z: v.z * c + nxv.z * s + n.z * nd * (1 - c),
  };
}

// sin^p profile: solve p so that ∫0..1 sin(πu)^p du = target.
function sinPowIntegral(p) {
  const N = 4000;
  let s = 0;
  for (let i = 0; i < N; i++) s += Math.sin(Math.PI * ((i + 0.5) / N)) ** p;
  return s / N;
}
function solveP(target) {
  let lo = 0.2;
  let hi = 8;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (sinPowIntegral(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- Timeline of |w| segments ----------------------------------------------
// Each segment: { durS, w(u) } with u in [0,1); w is the signed angular
// velocity about AXIS. Rests/tremor handled at sample time.
const segments = [];
const still = (durS) => segments.push({ durS, w: () => 0, moving: false });
const stroke = (durS, peak, romRad, sign) => {
  const p = solveP(romRad / (peak * durS));
  segments.push({ durS, w: (u) => sign * peak * Math.sin(Math.PI * u) ** p, moving: true });
};

still(0.24); // pickup fumble handled below (marked via time range)
still(0.63); // 0.24–0.87: the hand-held stillness window
still(1.1); // settle / small adjustment (extra wobble injected below)
for (const r of REPS) {
  stroke(r.concT, r.peak, r.romDeg * DEG, +1);
  still(0.35); // top pause
  const eccPeak = (r.romDeg * DEG) / (r.eccT * sinPowIntegral(1.4));
  stroke(r.eccT, eccPeak, r.romDeg * DEG, -1);
  still(1.3); // bottom rest
}
// Trailing rest fills to exactly N_SAMPLES.

// --- Sample synthesis -------------------------------------------------------
const perp1 = normalize(cross(AXIS, G0));
const perp2 = normalize(cross(AXIS, perp1));
const rows = [];
let theta = 0;
let lastW = 0;
const t0 = 4021.3;

for (let i = 0; i < N_SAMPLES; i++) {
  const tMs = t0 + i * DT;
  const tS = (i * DT) / 1000;

  // Locate segment.
  let acc = 0;
  let w = 0;
  let moving = false;
  for (const seg of segments) {
    if (tS < acc + seg.durS) {
      w = seg.w((tS - acc) / seg.durS);
      moving = seg.moving;
      break;
    }
    acc += seg.durS;
  }

  // Integrate the true angle (trapezoid on the clean profile).
  theta += (((w + lastW) / 2) * DT) / 1000;
  lastW = w;

  // Gyro = w·axis + cross-axis wobble while moving + hand tremor always.
  const wobble = moving
    ? add(
        scale(perp1, 0.25 * Math.sin(2 * Math.PI * 0.9 * tS + 0.7)),
        scale(perp2, 0.18 * Math.sin(2 * Math.PI * 1.3 * tS + 2.1))
      )
    : { x: 0, y: 0, z: 0 };
  // Pickup fumble (first 0.24 s) and settle window (0.87–1.90 s): sub-mask
  // multi-axis motion that must not read as reps at any tested threshold.
  // Ends 70 ms before rep 1 — a beat of stillness separates settling from
  // the first concentric, as it does when a human actually starts a set.
  const fumble =
    tS < 0.24 || (tS >= 0.87 && tS < 1.9)
      ? add(
          scale(perp1, 0.22 * Math.sin(2 * Math.PI * 1.7 * tS)),
          scale(perp2, 0.16 * Math.sin(2 * Math.PI * 2.3 * tS + 1.0)),
          // Phase chosen so the settle wobble's axis component ends on a
          // NEGATIVE lobe — the pre-set zero crossing a real pause has.
          scale(AXIS, 0.1 * Math.sin(2 * Math.PI * 1.1 * tS + Math.PI))
        )
      : { x: 0, y: 0, z: 0 };
  const tremor = {
    x: 0.05 * rnd() + 0.035 * Math.sin(2 * Math.PI * 9 * tS),
    y: 0.05 * rnd() + 0.03 * Math.sin(2 * Math.PI * 11 * tS + 1),
    z: 0.05 * rnd() + 0.028 * Math.sin(2 * Math.PI * 8 * tS + 2),
  };
  const gyro = add(scale(AXIS, w), wobble, fumble, tremor);

  // Accel: gravity counter-rotated by θ, plus hand tremor and stroke
  // dynamics (linear acceleration while moving).
  const gravity = scale(rotate(G0, AXIS, -theta), G);
  const dyn = moving
    ? {
        x: 0.9 * Math.sin(2 * Math.PI * 1.9 * tS) * Math.min(1, Math.abs(w)),
        y: 0.7 * Math.sin(2 * Math.PI * 2.6 * tS + 1.2) * Math.min(1, Math.abs(w)),
        z: 0.8 * Math.sin(2 * Math.PI * 2.2 * tS + 0.4) * Math.min(1, Math.abs(w)),
      }
    : { x: 0, y: 0, z: 0 };
  const accelNoise = { x: 0.09 * rnd(), y: 0.09 * rnd(), z: 0.09 * rnd() };
  const accel = add(gravity, dyn, accelNoise);

  rows.push(
    `${tMs.toFixed(1)},${gyro.x.toFixed(6)},${gyro.y.toFixed(6)},${gyro.z.toFixed(6)},` +
      `${accel.x.toFixed(4)},${accel.y.toFixed(4)},${accel.z.toFixed(4)}`
  );
}

const header =
  't_ms,gyro_x_radps,gyro_y_radps,gyro_z_radps,accel_x_mps2,accel_y_mps2,accel_z_mps2';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'handheld-curl-sweep.synthetic.csv'), [header, ...rows].join('\n'));

const expected = {
  note:
    'SYNTHETIC stand-in for the real on-device sweep (see scripts/generate-motion-fixture.mjs). ' +
    'Replace the CSV with the real capture and update these numbers to re-run against real data.',
  reps: 4,
  halfReps: 8,
  tier: 'handheld',
  concentricPeakW: REPS.map((r) => r.peak),
  concentricDurationsS: REPS.map((r) => r.concT),
  concentricRomDeg: REPS.map((r) => r.romDeg),
  pc1ShareMin: 0.85,
  pc1ShareMax: 0.98,
  pc1Pc2RatioMin: 10,
  sampleRateHzMin: 59.5,
  sampleRateHzMax: 60.5,
  droppedFrames: 0,
};
fs.writeFileSync(
  path.join(OUT_DIR, 'handheld-curl-sweep.synthetic.expected.json'),
  JSON.stringify(expected, null, 2) + '\n'
);

const total = segments.reduce((a, s) => a + s.durS, 0);
console.log(
  `wrote ${rows.length} samples (${((N_SAMPLES - 1) * DT) / 1000}s, segments ${total.toFixed(2)}s) to ${OUT_DIR}`
);

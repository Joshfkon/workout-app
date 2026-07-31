'use client';

/**
 * Angular-velocity trace for a motion capture: w(t) over the whole set,
 * concentric and eccentric spans shaded differently, rep boundaries marked.
 * Plain SVG — no chart library needed for one polyline and some rects.
 */

import { useMemo } from 'react';
import type { CaptureAnalysis } from '@/services/shared/motion';

const W = 640;
const H = 180;
const PAD_X = 6;
const PAD_Y = 12;
const MAX_POINTS = 700;

interface CaptureChartProps {
  analysis: CaptureAnalysis;
}

export function CaptureChart({ analysis }: CaptureChartProps) {
  const { tMs, w, halfReps, reps } = analysis;

  const model = useMemo(() => {
    const n = w.length;
    if (n < 2) return null;
    const t0 = tMs[0];
    const tSpan = Math.max(1, tMs[n - 1] - t0);
    const wMax = Math.max(0.5, ...w.map(Math.abs));
    const x = (i: number) => PAD_X + ((tMs[i] - t0) / tSpan) * (W - 2 * PAD_X);
    const y = (v: number) => H / 2 - (v / wMax) * (H / 2 - PAD_Y);

    const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
    const pts: string[] = [];
    for (let i = 0; i < n; i += stride) pts.push(`${x(i).toFixed(1)},${y(w[i]).toFixed(1)}`);
    pts.push(`${x(n - 1).toFixed(1)},${y(w[n - 1]).toFixed(1)}`);

    return {
      x,
      y,
      wMax,
      points: pts.join(' '),
      spans: halfReps.map((h) => ({
        dir: h.dir,
        x0: x(h.startIdx),
        x1: x(h.endIdx),
      })),
      repStarts: reps.map((r) => ({ index: r.index, x0: x(r.concentric.startIdx) })),
    };
  }, [tMs, w, halfReps, reps]);

  if (!model) return null;

  return (
    <div className="overflow-hidden rounded-lg bg-surface-900/60 p-2" data-testid="motion-capture-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Angular velocity over the set">
        {/* Concentric (positive) vs eccentric (negative) span shading */}
        {model.spans.map((s, i) => (
          <rect
            key={i}
            x={s.x0}
            y={PAD_Y}
            width={Math.max(1, s.x1 - s.x0)}
            height={H - 2 * PAD_Y}
            className={s.dir === 1 ? 'fill-primary-500/15' : 'fill-warning-500/15'}
          />
        ))}
        {/* Zero line */}
        <line x1={PAD_X} y1={H / 2} x2={W - PAD_X} y2={H / 2} className="stroke-surface-600" strokeWidth="1" strokeDasharray="4 4" />
        {/* Rep boundaries */}
        {model.repStarts.map((r) => (
          <g key={r.index}>
            <line x1={r.x0} y1={PAD_Y} x2={r.x0} y2={H - PAD_Y} className="stroke-surface-400" strokeWidth="1" />
            <text x={r.x0 + 3} y={PAD_Y + 10} className="fill-surface-400" fontSize="10">
              {r.index + 1}
            </text>
          </g>
        ))}
        {/* w(t) */}
        <polyline points={model.points} fill="none" className="stroke-primary-400" strokeWidth="1.5" />
        {/* Scale hint */}
        <text x={W - PAD_X - 2} y={PAD_Y + 2} textAnchor="end" className="fill-surface-500" fontSize="10">
          ±{model.wMax.toFixed(1)} rad/s
        </text>
      </svg>
      <p className="mt-1 text-[10px] text-surface-500">
        <span className="text-primary-400">■</span> concentric&nbsp;&nbsp;
        <span className="text-warning-400">■</span> eccentric&nbsp;&nbsp;— numbered lines mark rep starts
      </p>
    </div>
  );
}

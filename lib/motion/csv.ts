/**
 * CSV export of raw IMU sample buffers — debug tooling so a bad
 * calibration/capture can be inspected outside the app (units in the
 * header: rad/s, m/s², ms from performance.now()).
 */

import type { ImuSample } from '@/types/motion';
import type { CaptureAnalysis } from '@/services/shared/motion';

export const IMU_CSV_HEADER =
  't_ms,gyro_x_radps,gyro_y_radps,gyro_z_radps,accel_x_mps2,accel_y_mps2,accel_z_mps2';

export const REP_METRICS_CSV_HEADER =
  'rep,rom_deg,mean_concentric_w_radps,peak_concentric_w_radps,bottom_dwell_ms,turnaround_peak_accel_radps2';

export function samplesToCsv(samples: ImuSample[]): string {
  const rows = samples.map(
    (s) =>
      `${s.tMs.toFixed(1)},${s.gyro.x.toFixed(6)},${s.gyro.y.toFixed(6)},${s.gyro.z.toFixed(6)},` +
      `${s.accel.x.toFixed(4)},${s.accel.y.toFixed(4)},${s.accel.z.toFixed(4)}`
  );
  return [IMU_CSV_HEADER, ...rows].join('\n');
}

/**
 * Full capture export: raw samples, then the per-rep metric table as a
 * second section (comment-prefixed header so single-section parsers of the
 * raw schema stay compatible).
 */
export function captureToCsv(samples: ImuSample[], analysis: CaptureAnalysis | null): string {
  const raw = samplesToCsv(samples);
  if (!analysis || analysis.reps.length === 0) return raw;
  const metricRows = analysis.reps.map(
    (r) =>
      `${r.index + 1},${r.romConcentricDeg.toFixed(2)},${r.meanWConcentric.toFixed(4)},` +
      `${r.peakW.toFixed(4)},${r.bottomDwellMs === null ? '' : r.bottomDwellMs.toFixed(0)},` +
      `${r.turnaroundPeakAccelRadps2 === null ? '' : r.turnaroundPeakAccelRadps2.toFixed(3)}`
  );
  return [raw, '', '# per-rep metrics', REP_METRICS_CSV_HEADER, ...metricRows].join('\n');
}

/** Trigger a client-side download of a text file. */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay so the click has consumed the URL first.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

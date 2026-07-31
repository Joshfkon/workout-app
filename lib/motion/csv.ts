/**
 * CSV export of raw IMU sample buffers — debug tooling so a bad
 * calibration/capture can be inspected outside the app (units in the
 * header: rad/s, m/s², ms from performance.now()).
 */

import type { ImuSample } from '@/types/motion';

export const IMU_CSV_HEADER =
  't_ms,gyro_x_radps,gyro_y_radps,gyro_z_radps,accel_x_mps2,accel_y_mps2,accel_z_mps2';

export function samplesToCsv(samples: ImuSample[]): string {
  const rows = samples.map(
    (s) =>
      `${s.tMs.toFixed(1)},${s.gyro.x.toFixed(6)},${s.gyro.y.toFixed(6)},${s.gyro.z.toFixed(6)},` +
      `${s.accel.x.toFixed(4)},${s.accel.y.toFixed(4)},${s.accel.z.toFixed(4)}`
  );
  return [IMU_CSV_HEADER, ...rows].join('\n');
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

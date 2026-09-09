'use client';

import type { Experience } from '@/types/schema';
import { Card, CardHeader, CardTitle, CardContent, Input } from '@/components/ui';
import { STANDARD_MUSCLE_GROUPS, STANDARD_MUSCLE_DISPLAY_NAMES, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import { DIRECT_MEV_TOOLTIP } from '@/services/volumeBands';
import {
  boundedComponentHint,
  parentMrvFor,
  validateLandmarkRow,
} from '@/lib/training/landmarkValidation';
import { MUSCLE_VOLUME_AUTHORITY } from '@/types/schema';

interface VolumeLandmarksCardProps {
  experience: Experience;
  volumeLandmarks: Record<string, { mev: number; mav: number; mrv: number }>;
  setVolumeLandmarks: React.Dispatch<React.SetStateAction<Record<string, { mev: number; mav: number; mrv: number }>>>;
}

export function VolumeLandmarksCard({ experience, volumeLandmarks, setVolumeLandmarks }: VolumeLandmarksCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Volume Landmarks</CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          Weekly sets per muscle group (based on Dr. Mike Israetel&apos;s research)
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Explanation box */}
          <div className="p-4 bg-surface-800/50 rounded-lg border border-surface-700 space-y-3">
            <div className="flex gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-warning-500/20 border border-warning-500/40 rounded text-xs flex items-center justify-center font-medium text-warning-400">MEV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Minimum Effective Volume</span> — {DIRECT_MEV_TOOLTIP}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-success-500/20 border border-success-500/40 rounded text-xs flex items-center justify-center font-medium text-success-400">MAV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Maximum Adaptive Volume</span> — Sweet spot for growth</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-danger-500/20 border border-danger-500/40 rounded text-xs flex items-center justify-center font-medium text-danger-400">MRV</span>
                <span className="text-surface-400"><span className="font-medium text-surface-200">Maximum Recoverable Volume</span> — Upper limit before overtraining</span>
              </div>
            </div>
            <p className="text-xs text-surface-500 border-t border-surface-700 pt-3">
              These values are pre-filled based on your experience level and published hypertrophy research. Adjust based on your personal recovery capacity and response.
            </p>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-4">
            <span className="w-24 text-xs text-surface-500 font-medium">Muscle</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-xs text-center">
              <span className="text-warning-400 font-medium" title={DIRECT_MEV_TOOLTIP}>Direct MEV</span>
              <span className="text-success-400 font-medium">MAV</span>
              <span className="text-danger-400 font-medium">MRV</span>
            </div>
          </div>

          {STANDARD_MUSCLE_GROUPS.map((muscle) => {
            const defaultLandmark = DEFAULT_VOLUME_LANDMARKS[experience][muscle] || { mev: 6, mav: 12, mrv: 20 };
            const landmarks = volumeLandmarks[muscle] || defaultLandmark;
            const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
            // Bounded components stay EDITABLE — their values still drive
            // local status and progression, so making them read-only would
            // hide behaviourally-active numbers. They are validated instead:
            // a component may not claim more capacity than its parent.
            const parentMrv = parentMrvFor(
              muscle,
              volumeLandmarks,
              DEFAULT_VOLUME_LANDMARKS[experience]
            );
            const violation = validateLandmarkRow(landmarks, parentMrv);
            const hint = boundedComponentHint(muscle, parentMrv);
            const commit = (next: { mev: number; mav: number; mrv: number }) =>
              setVolumeLandmarks({ ...volumeLandmarks, [muscle]: next });
            return (
              <div key={muscle} className="space-y-1">
                <div className="flex items-center gap-4">
                  <span className="w-24 text-sm text-surface-300">
                    {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                    {parent && (
                      <span className="block text-[10px] leading-tight text-surface-500">
                        subtarget
                      </span>
                    )}
                  </span>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      value={landmarks.mev ?? 6}
                      onChange={(e) => commit({ ...landmarks, mev: parseInt(e.target.value) || 0 })}
                      className="text-center"
                    />
                    <Input
                      type="number"
                      value={landmarks.mav ?? 12}
                      onChange={(e) => commit({ ...landmarks, mav: parseInt(e.target.value) || 0 })}
                      className="text-center"
                    />
                    <Input
                      type="number"
                      value={landmarks.mrv ?? 20}
                      onChange={(e) => commit({ ...landmarks, mrv: parseInt(e.target.value) || 0 })}
                      className="text-center"
                    />
                  </div>
                </div>
                {hint && <p className="pl-28 text-xs text-surface-500">{hint}</p>}
                {violation && (
                  <p className="pl-28 text-xs text-warning-400">{violation}</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-4 pt-2 border-t border-surface-800">
            <span className="w-24 text-xs text-surface-500">Legend</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-center text-xs text-surface-500">
              <span>MEV</span>
              <span>MAV</span>
              <span>MRV</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

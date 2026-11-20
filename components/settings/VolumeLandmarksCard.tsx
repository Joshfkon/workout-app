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
        <CardTitle>Volume landmarks</CardTitle>
        <p className="text-body text-ink-2 mt-1">
          Weekly sets per muscle group (based on Dr. Mike Israetel&apos;s research)
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Explanation box */}
          <div className="p-4 bg-fill/50 rounded-lg border border-sep space-y-3">
            <div className="flex gap-6 flex-wrap text-body">
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-status-warn/20 border border-status-warn/40 rounded text-caption flex items-center justify-center font-medium text-status-warn">MEV</span>
                <span className="text-ink-2"><span className="font-medium text-ink">Minimum effective volume</span> — {DIRECT_MEV_TOOLTIP}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-status-ok/20 border border-status-ok/40 rounded text-caption flex items-center justify-center font-medium text-status-ok">MAV</span>
                <span className="text-ink-2"><span className="font-medium text-ink">Maximum adaptive volume</span> — Sweet spot for growth</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 h-6 bg-status-bad/20 border border-status-bad/40 rounded text-caption flex items-center justify-center font-medium text-status-bad">MRV</span>
                <span className="text-ink-2"><span className="font-medium text-ink">Maximum recoverable volume</span> — Upper limit before overtraining</span>
              </div>
            </div>
            <p className="text-caption text-ink-3 border-t border-sep pt-3">
              These values are pre-filled based on your experience level and published hypertrophy research. Adjust based on your personal recovery capacity and response.
            </p>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-4">
            <span className="w-24 text-caption text-ink-3 font-medium">Muscle</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-caption text-center">
              <span className="text-status-warn font-medium" title={DIRECT_MEV_TOOLTIP}>Direct MEV</span>
              <span className="text-status-ok font-medium">MAV</span>
              <span className="text-status-bad font-medium">MRV</span>
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
                  <span className="w-24 text-body text-ink-2">
                    {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                    {parent && (
                      <span className="block text-caption text-ink-3">
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
                {hint && <p className="pl-28 text-caption text-ink-3">{hint}</p>}
                {violation && (
                  <p className="pl-28 text-caption text-status-warn">{violation}</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-4 pt-2 border-t border-sep">
            <span className="w-24 text-caption text-ink-3">Legend</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-center text-caption text-ink-3">
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

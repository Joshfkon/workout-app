'use client';

/**
 * Body hub inline nudges + reminder settings:
 *
 *   - Tape staleness: dismissible prompt when the last tape entry is older
 *     than the configured interval (default 4 weeks). Never shows for users
 *     who have never logged tape; 0 weeks turns it off.
 *   - DEXA due: only when the user has enabled it (interval unset = off).
 *     When the user has >= 2 scans and hasn't chosen, a one-time suggestion
 *     offers a 12-week reminder.
 *
 * Dismissals snooze locally for 7 days (localStorage); intervals persist in
 * users.preferences (read-merge-write so unrelated keys survive).
 */

import { useEffect, useState } from 'react';
import { IconRuler2, IconScan, IconSettings, IconX } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { BottomSheet } from '@/components/workout/BottomSheet';
import type { BodyLogSegment } from '@/components/body/LogBodyDataSheet';

const DEFAULT_MEASURE_NUDGE_WEEKS = 4;
const SUGGESTED_DEXA_WEEKS = 12;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const MEASURE_SNOOZE_KEY = 'bodyHub.measureNudgeSnoozedAt';
const DEXA_SNOOZE_KEY = 'bodyHub.dexaNudgeSnoozedAt';

interface HubPreferences {
  measurementNudgeWeeks?: number;
  dexaReminderWeeks?: number | null;
  dexaReminderDeclined?: boolean;
}

interface BodyHubNudgesProps {
  /** Opens the unified log sheet on the given segment. */
  onLog: (segment: BodyLogSegment) => void;
  /** Bump to refetch after the log sheet saves something. */
  refreshKey?: number;
}

function weeksSince(dateStr: string): number {
  const ms = Date.now() - new Date(`${dateStr}T00:00:00`).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

function isSnoozed(key: string): boolean {
  try {
    const at = Number(localStorage.getItem(key) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Ignore storage failures — the nudge just reappears next visit.
  }
}

export function BodyHubNudges({ onLog, refreshKey = 0 }: BodyHubNudgesProps) {
  const supabase = createUntypedClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<HubPreferences>({});
  const [lastTapeDate, setLastTapeDate] = useState<string | null>(null);
  const [lastScanDate, setLastScanDate] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  // Local dismiss state so the banners disappear immediately on tap.
  const [measureDismissed, setMeasureDismissed] = useState(false);
  const [dexaDismissed, setDexaDismissed] = useState(false);

  useEffect(() => {
    async function fetchAll() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        const [tapeRes, scanRes, scanCountRes, prefsRes] = await Promise.all([
          supabase
            .from('body_measurements')
            .select('logged_at')
            .eq('user_id', user.id)
            .order('logged_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('dexa_scans')
            .select('scan_date')
            .eq('user_id', user.id)
            .order('scan_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('dexa_scans')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase.from('users').select('preferences').eq('id', user.id).single(),
        ]);

        setLastTapeDate((tapeRes.data as { logged_at: string } | null)?.logged_at ?? null);
        setLastScanDate((scanRes.data as { scan_date: string } | null)?.scan_date ?? null);
        setScanCount(scanCountRes.count ?? 0);
        setPrefs(((prefsRes.data as { preferences: HubPreferences | null } | null)?.preferences ?? {}) as HubPreferences);
      } catch (err) {
        console.error('Failed to load body nudge data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const savePrefs = async (patch: HubPreferences) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    if (!userId) return;
    // Read-merge-write so unrelated preference keys survive.
    const { data } = await supabase.from('users').select('preferences').eq('id', userId).single();
    const preferences = { ...((data as { preferences: object | null } | null)?.preferences ?? {}), ...patch };
    const { error } = await supabase.from('users').update({ preferences }).eq('id', userId);
    if (error) console.error('Failed to save body hub preferences:', error);
  };

  if (isLoading) return null;

  const measureWeeksSetting = prefs.measurementNudgeWeeks ?? DEFAULT_MEASURE_NUDGE_WEEKS;
  const tapeWeeks = lastTapeDate ? weeksSince(lastTapeDate) : null;
  const showMeasureNudge =
    !measureDismissed &&
    measureWeeksSetting > 0 &&
    tapeWeeks !== null && // never nudge someone who has never logged tape
    tapeWeeks >= measureWeeksSetting &&
    !isSnoozed(MEASURE_SNOOZE_KEY);

  const dexaWeeksSetting = prefs.dexaReminderWeeks ?? null;
  const scanWeeks = lastScanDate ? weeksSince(lastScanDate) : null;
  const showDexaNudge =
    !dexaDismissed &&
    dexaWeeksSetting != null &&
    dexaWeeksSetting > 0 &&
    scanWeeks !== null &&
    scanWeeks >= dexaWeeksSetting &&
    !isSnoozed(DEXA_SNOOZE_KEY);

  const showDexaSuggestion =
    dexaWeeksSetting == null && !prefs.dexaReminderDeclined && scanCount >= 2 && !showDexaNudge;

  return (
    <>
      {showMeasureNudge && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-warning-500/10 border border-warning-500/20">
          <IconRuler2 size={18} className="text-warning-400 flex-shrink-0" aria-hidden="true" />
          <p className="flex-1 text-[13px] text-surface-300">
            Last measurements: {tapeWeeks} {tapeWeeks === 1 ? 'week' : 'weeks'} ago — log a set?
          </p>
          <button
            onClick={() => onLog('measurements')}
            className="px-3 py-1.5 rounded-lg bg-warning-500/20 text-warning-300 text-xs font-medium hover:bg-warning-500/30 transition-colors flex-shrink-0"
          >
            Log
          </button>
          <button
            onClick={() => {
              snooze(MEASURE_SNOOZE_KEY);
              setMeasureDismissed(true);
            }}
            className="p-1 rounded text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
            aria-label="Dismiss measurement reminder"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {showDexaNudge && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20">
          <IconScan size={18} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
          <p className="flex-1 text-[13px] text-surface-300">
            DEXA due — last scan {scanWeeks} {scanWeeks === 1 ? 'week' : 'weeks'} ago.
          </p>
          <button
            onClick={() => onLog('dexa')}
            className="px-3 py-1.5 rounded-lg bg-primary-500/20 text-primary-300 text-xs font-medium hover:bg-primary-500/30 transition-colors flex-shrink-0"
          >
            Log scan
          </button>
          <button
            onClick={() => {
              snooze(DEXA_SNOOZE_KEY);
              setDexaDismissed(true);
            }}
            className="p-1 rounded text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
            aria-label="Dismiss DEXA reminder"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {showDexaSuggestion && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-900 border border-surface-800">
          <IconScan size={18} className="text-surface-400 flex-shrink-0" aria-hidden="true" />
          <p className="flex-1 text-[13px] text-surface-400">
            Want a &quot;DEXA due&quot; reminder? Suggested: every {SUGGESTED_DEXA_WEEKS} weeks.
          </p>
          <button
            onClick={() => savePrefs({ dexaReminderWeeks: SUGGESTED_DEXA_WEEKS })}
            className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-200 text-xs font-medium hover:bg-surface-700 transition-colors flex-shrink-0"
          >
            Enable
          </button>
          <button
            onClick={() => savePrefs({ dexaReminderDeclined: true })}
            className="p-1 rounded text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
            aria-label="Decline DEXA reminder"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Settings trigger lives with the nudges so the intervals are
          discoverable where their effects appear. */}
      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-1.5 text-[11px] text-surface-500 hover:text-surface-300 transition-colors"
      >
        <IconSettings size={13} aria-hidden="true" />
        Reminder settings
      </button>

      <BottomSheet
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Body data reminders"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] text-surface-300 mb-1.5" htmlFor="measure-nudge-weeks">
              Tape measurement nudge
            </label>
            <select
              id="measure-nudge-weeks"
              value={measureWeeksSetting}
              onChange={(e) => savePrefs({ measurementNudgeWeeks: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-[13px]"
            >
              <option value={0}>Off</option>
              {[2, 4, 6, 8].map((w) => (
                <option key={w} value={w}>
                  Every {w} weeks
                </option>
              ))}
            </select>
            <p className="text-[11px] text-surface-500 mt-1">
              Shows once your last tape entry is older than this. Never shows
              before your first entry.
            </p>
          </div>

          <div>
            <label className="block text-[13px] text-surface-300 mb-1.5" htmlFor="dexa-reminder-weeks">
              DEXA due reminder
            </label>
            <select
              id="dexa-reminder-weeks"
              value={dexaWeeksSetting ?? 0}
              onChange={(e) => {
                const value = Number(e.target.value);
                savePrefs({ dexaReminderWeeks: value > 0 ? value : null });
              }}
              className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-[13px]"
            >
              <option value={0}>Off</option>
              {[8, 12, 16, 24].map((w) => (
                <option key={w} value={w}>
                  Every {w} weeks
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowSettings(false)}
            className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors"
          >
            Done
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

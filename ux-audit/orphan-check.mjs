/* READ-ONLY orphan check (service role, SELECT only) — mirrors
 * ux-audit/fixes/P0-1/orphan-sweep.md after this session's flow regression. */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('C:/Users/joshu/Desktop/Dec WorkoutApp/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const userId = '00045fe1-c4a1-40e1-bab1-9b9a71126ca8'; // test account (from JWT sub)
const windowStart = new Date(Date.now() - 3 * 3600e3).toISOString(); // this session's work window

// 1. sessions started in the work window
const { data: recentSessions } = await supabase
  .from('workout_sessions')
  .select('id, state, planned_date, started_at, mesocycle_id')
  .eq('user_id', userId)
  .gte('started_at', windowStart);
console.log('sessions started in last 3h:', recentSessions?.length ?? 'ERR', JSON.stringify(recentSessions));

// 2. today's ad-hoc sessions (any state)
const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
const { data: todayAdhoc } = await supabase
  .from('workout_sessions')
  .select('id, state, started_at')
  .eq('user_id', userId)
  .eq('planned_date', today)
  .is('mesocycle_id', null);
console.log('ad-hoc sessions today:', todayAdhoc?.length ?? 'ERR', JSON.stringify(todayAdhoc));

// 3. set_logs created in the window
const { data: recentSets } = await supabase
  .from('set_logs')
  .select('id, exercise_block_id, created_at')
  .gte('created_at', windowStart);
console.log('set_logs in last 3h (all users, service view):', recentSets?.length ?? 'ERR');

// 4. detached amrap calibration rows (both FKs null)
const { data: orphanAmrap } = await supabase
  .from('amrap_calibrations')
  .select('id, created_at')
  .is('workout_session_id', null)
  .is('set_log_id', null);
console.log('detached amrap rows:', orphanAmrap?.length ?? 'ERR', JSON.stringify(orphanAmrap));

// 5. exercise_blocks whose parent session no longer exists can't exist (FK), but
// check blocks with zero sets on in_progress sessions today for completeness
const ids = (todayAdhoc || []).map((s) => s.id);
if (ids.length) {
  const { data: blocks } = await supabase
    .from('exercise_blocks')
    .select('id, workout_session_id')
    .in('workout_session_id', ids);
  console.log('blocks on today ad-hoc sessions:', blocks?.length ?? 'ERR');
} else {
  console.log('blocks on today ad-hoc sessions: 0 (no sessions)');
}
console.log('ORPHAN CHECK DONE (read-only)');

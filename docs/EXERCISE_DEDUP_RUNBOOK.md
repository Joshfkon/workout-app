# Exercise Dedup Runbook

Step-by-step for applying the merge migration and cleaning up duplicate
exercises. Commands are given for **Windows PowerShell** (the folder path has a
space, so it's quoted) with macOS/Linux equivalents where they differ.

Related files:
- Migration: `supabase/migrations/20260711000002_exercise_soft_delete_and_merge.sql`
- Audit script: `scripts/exerciseDedupAudit.ts` → writes `docs/EXERCISE_DEDUP_AUDIT.md`
- Merge script: `scripts/mergeExercises.ts`

---

## 1. Pull the branch

```powershell
cd "C:\Users\joshu\Desktop\Dec WorkoutApp"
git fetch origin
git checkout claude/exercise-dedup-audit-merge-5lrklg
git pull origin claude/exercise-dedup-audit-merge-5lrklg
```

Sanity check — should show the "Exercise DB cleanup…" commit:

```powershell
git log --oneline -1
```

If `ts-node` or other deps are missing, run once:

```powershell
npm install
```

## 2. Apply the migration to the linked Supabase project

Preview first (nothing is written):

```powershell
npx supabase db push --dry-run
```

Confirm `20260711000002_exercise_soft_delete_and_merge.sql` is in the list, then
apply:

```powershell
npx supabase db push
```

Notes:
- Verify which project you're targeting: `npx supabase projects list` (linked one
  is marked with a dot).
- If it prompts for a **database password**, that's the DB password from
  Supabase → Project Settings → Database (not your account password).
- Local stack (`npx supabase start` / `db reset`) needs Docker Desktop running.

What the migration does:
- Adds `exercises.deleted_at` + `exercises.merged_into` (soft-delete trail).
- Adds `merge_exercises(survivor, duplicates[], dry_run)` and
  `unmerge_exercise(id)` (service-role only).
- After this, the app automatically hides soft-deleted exercises.

## 3. Set service-role env vars (for the scripts)

PowerShell (lasts for the current window only):

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL="https://<your-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

macOS/Linux equivalent — prefix each command with the vars:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  npx ts-node scripts/exerciseDedupAudit.ts
```

Find the service-role key in Supabase → Project Settings → API →
`service_role` secret. **Keep it secret** — it bypasses row-level security.

## 4. Generate the audit (read-only, changes nothing)

```powershell
npx ts-node scripts/exerciseDedupAudit.ts
```

This overwrites `docs/EXERCISE_DEDUP_AUDIT.md` with the real duplicate groups,
each showing per-entry set-log counts, last-logged date, and routine/mesocycle
references, plus a suggested survivor (✅) and a ready-to-run merge command.

## 5. Merge — one group at a time

For each group in the audit doc, **dry-run first** and read the counts:

```powershell
npx ts-node scripts/mergeExercises.ts --survivor <survivorId> --duplicates <dupId1>,<dupId2> --dry-run
```

The dry-run reports how many set logs, template/mesocycle refs, etc. will move,
and which per-user settings will be dropped (survivor's values win). If it looks
right, apply that one group:

```powershell
npx ts-node scripts/mergeExercises.ts --survivor <survivorId> --duplicates <dupId1>,<dupId2> --execute
```

Rules of the road:
- Nothing merges automatically — you run each group yourself.
- Merges are **soft-delete only** and reversible: re-running with `--execute` is
  idempotent, and a mistake can be undone by calling `unmerge_exercise(id)` (via
  SQL/RPC) which un-hides the row.
- The survivor keeps its own settings (rep ranges, YouTube video, bodyweight
  type); conflicting duplicate settings are dropped and reported.

## 6. Verify

- Open the app → the merged duplicates no longer appear in pickers/library.
- Open the survivor's history / e1RM chart → the merged set history is present.
- Optional: re-run `scripts/exerciseDedupAudit.ts` to confirm the group is gone.

## Troubleshooting

- **PowerShell blocks `npx`** (execution policy): run from Git Bash or cmd, or
  `Set-ExecutionPolicy -Scope Process RemoteSigned` in that window.
- **`ts-node: command not found`**: run `npm install` in the folder.
- **`db push` says "no migrations to apply"** but the file is there: you're on
  the wrong branch — recheck `git log --oneline -1`.
- **Script errors with "Set NEXT_PUBLIC_SUPABASE_URL…"**: the env vars aren't set
  in the current window (step 3); `$env:` vars don't carry across windows.

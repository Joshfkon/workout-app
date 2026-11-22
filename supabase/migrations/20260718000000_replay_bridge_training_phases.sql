-- Replay bridge: lets 20260718000001_training_phases apply on an EMPTY database.
--
-- 20241212000004_ai_coaching created an older, unrelated training_phases table
-- (start_date / is_active / start_weight_kg NOT NULL, phase_type limited to
-- cut|bulk|maintain, UNIQUE(user_id, is_active)). On a fresh replay it wins the
-- CREATE TABLE IF NOT EXISTS in 20260718000001, whose index on start_day then
-- fails and aborts `supabase db reset`. Adding the new columns to the old table
-- would not be enough: its constraints reject a second phase and the
-- recomp/maintenance types the app writes.
--
-- 20260718000001 could only have succeeded on production if no such table
-- existed there, so production has the 20260718 shape. On a database that
-- still has the legacy shape, move it aside (it is empty on a fresh replay)
-- so 20260718000001 creates the table the app uses.
--
-- Back-dated on purpose: it has to run before 20260718000001. On production
-- training_phases already has start_day, so this is a no-op there.
DO $$
BEGIN
  IF to_regclass('public.training_phases') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'training_phases'
         AND column_name = 'start_day'
     )
  THEN
    IF EXISTS (SELECT 1 FROM public.training_phases) THEN
      -- Never drop data: keep the rows under another name.
      ALTER TABLE public.training_phases RENAME TO training_phases_legacy;
    ELSE
      DROP TABLE public.training_phases;
    END IF;
  END IF;
END $$;

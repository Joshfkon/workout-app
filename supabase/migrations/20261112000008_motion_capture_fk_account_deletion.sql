-- Native review finding 3: account deletion failed for users with motion
-- captures.
--
-- motion_captures.calibration_id was ON DELETE RESTRICT, while both
-- motion_captures and machine_calibrations cascade from users. RESTRICT is
-- checked immediately, so when deleting the user cascaded into
-- machine_calibrations first the delete errored and the whole account
-- deletion failed.
--
-- NO ACTION keeps the invariant ("a calibration that captures reference
-- cannot be deleted out from under them") but is checked at the END of the
-- statement, by which point the same cascade has removed the captures too.
-- Deleting a referenced calibration on its own still fails.
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.motion_captures') IS NULL
     OR to_regclass('public.machine_calibrations') IS NULL THEN
    RETURN;
  END IF;

  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.motion_captures'::regclass
      AND con.confrelid = 'public.machine_calibrations'::regclass
      AND con.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE public.motion_captures DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.motion_captures
    ADD CONSTRAINT motion_captures_calibration_id_fkey
    FOREIGN KEY (calibration_id) REFERENCES public.machine_calibrations(id)
    ON DELETE NO ACTION;
END $$;

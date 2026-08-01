-- Motion capture: record whether the user had expanded any Observations
-- block earlier in the same workout when this capture was saved.
--
-- Nothing reads this yet. It exists so the future velocity-loss -> RIR
-- dataset can be filtered for label contamination: a lifter who has just
-- read "mean concentric velocity fell 34%" may anchor their next RIR entry
-- on the metrics instead of their own perception, and those labels need to
-- be separable from uncontaminated ones.

ALTER TABLE motion_captures
  ADD COLUMN IF NOT EXISTS prior_observations_viewed_this_session BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN motion_captures.prior_observations_viewed_this_session IS
  'True if the user expanded any motion Observations block earlier in the same workout before this capture was saved. Read by nothing; future RIR-fit dataset filter (label-contamination flag).';

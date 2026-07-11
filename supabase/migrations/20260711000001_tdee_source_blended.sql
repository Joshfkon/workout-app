-- Allow the 'blended' TDEE source.
--
-- The adaptive TDEE card is now driven by an interval-based estimator that
-- Bayesian-blends the formula prior with observed weigh-in intervals. Its
-- source is 'blended' (formula-leaning early, data-leaning later) rather than a
-- hard 'regression'/'formula' switch, so the CHECK constraint must accept it.

ALTER TABLE tdee_estimates
  DROP CONSTRAINT IF EXISTS tdee_estimates_source_check;

ALTER TABLE tdee_estimates
  ADD CONSTRAINT tdee_estimates_source_check
  CHECK (source IN ('regression', 'formula', 'blended'));

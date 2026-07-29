-- Dumbbell increment granularity: 5 lb -> 2.5 lb.
--
-- Audit (2026-07-29, static catalog + post-lb-native DB values):
--   barbell    2.27 kg (5 lb, 2.5/side)      x25  -- correct
--   machine    4.54 kg (10 lb stack)         x23  -- correct
--   machine    2.27 kg (5 lb stack+add-ons)  x8   -- correct
--   cable      2.27 kg (5 lb)                x23  -- correct
--   dumbbell   2.27 kg (5 lb)                x17  -- WRONG, fixed here
--   dumbbell   1.13 kg (2.5 lb)              x11  -- correct
--   bodyweight 0                             x19  -- correct
--
-- The 20260725000002 lb-native mapping sent the kg-era dumbbell default
-- (2.0 kg, "dumbbell jumps") to 2.27 kg = 5 lb. That models the jump between
-- FIXED rack pairs, but prescription increments must model the smallest step
-- the lifter can actually load: racks and adjustables step in 2.5 lb
-- (77.5 lb dumbbells exist only on a 2.5 lb grid). Live defect: at
-- 77.5 lb x 12 @2 RIR the rep_total bump gate priced a +5 lb step, projected
-- a sub-floor rep count, and held the load with a "step up would drop you
-- below the 8-rep floor" rationale — the lifter manually loaded 80 lb and
-- logged 11/11/10 @2 RIR, exactly what a 2.5 lb-step pricing predicts.
--
-- Mapping is by exact library-default value (same convention as
-- 20260725000002), so a deliberately customized coarser value that happens
-- to equal the old default is corrected too — acceptable, since the old
-- default was itself the defect. 2.0 kg is included for rows that never
-- received the lb-native mapping.

UPDATE exercises
SET min_weight_increment_kg = 1.13
WHERE equipment = 'dumbbell'
  AND min_weight_increment_kg IN (2.0, 2.27);

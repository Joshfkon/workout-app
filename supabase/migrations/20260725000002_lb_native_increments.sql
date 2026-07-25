-- Phase 3: lb-native load increments.
--
-- Audit (seed.sql, reported before this change): increments were authored on
-- a kg grid — 2.5 kg ×14, 2.0 kg ×8, 5.0 kg ×9, 1.0 kg ×3, 10.0 kg ×2,
-- 0.0 ×2 (bodyweight). NINE exercises carried a 5.0 kg increment on
-- lb-denominated implements (8 stack/cable machines + Barbell Shrug):
-- Machine Chest Press, Lat Pulldown, Cable Row, Hack Squat, Cable Pull
-- Through, Standing Calf Raise, Seated Calf Raise, Cable Crunch, Barbell
-- Shrug. Rounding a lb-native load to a kg grid produced phantom deltas
-- (135 lb → 61.23 kg → 60 kg → "132.5 lb").
--
-- Fix: increments become EXACT kg equivalents of standard lb steps, so
-- rounding to the increment grid lands on clean native-unit loads:
--   1.0  kg → 1.13 kg (2.5 lb)   small isolation plates
--   2.0  kg → 2.27 kg (5 lb)     dumbbell jumps
--   2.5  kg → 2.27 kg (5 lb)     barbell (2.5 lb per side)
--   5.0  kg → 4.54 kg (10 lb)    stack machines / big-jump barbell moves
--   10.0 kg → 9.07 kg (20 lb)    leg press (10 lb per side)
-- 0 (bodyweight) rows are untouched. Mapping is by exact current value, so
-- custom exercises that used the same library defaults are corrected too.

UPDATE exercises SET min_weight_increment_kg = 1.13  WHERE min_weight_increment_kg = 1.0;
UPDATE exercises SET min_weight_increment_kg = 2.27  WHERE min_weight_increment_kg IN (2.0, 2.5);
UPDATE exercises SET min_weight_increment_kg = 4.54  WHERE min_weight_increment_kg = 5.0;
UPDATE exercises SET min_weight_increment_kg = 9.07  WHERE min_weight_increment_kg = 10.0;

-- ADD 2 (Phase 5 pulled forward): per-exercise progression model.
--
--   progression_model:
--     'e1rm'      — anchor-driven load prescriptions (default behavior)
--     'rep_total' — fixed session load, progress on session rep total; no
--                   e1RM computed/displayed/ingested for calibration
--     NULL        — auto-classify from recent history (majority of recent
--                   normal sets beyond the canonical estimator's
--                   15-effective-rep domain → rep_total)
--
--   rep_boundary:
--     'crisp'    — a rep is a discrete, countable unit (default)
--     'drifting' — rep quality/ROM drifts at high counts (calves, abs);
--                  metadata for future auto-classification

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS progression_model TEXT
    CHECK (progression_model IN ('e1rm', 'rep_total')),
  ADD COLUMN IF NOT EXISTS rep_boundary TEXT NOT NULL DEFAULT 'crisp'
    CHECK (rep_boundary IN ('crisp', 'drifting'));

-- Explicit assignment per the approved plan. Everything else stays NULL
-- (auto-classified from history) pending the user's review of the printed
-- classification list.
UPDATE exercises
SET progression_model = 'rep_total', rep_boundary = 'drifting'
WHERE name = 'Seated Calf Raise';

# Report F — Migration

## Landmark lifecycle

| Stage | Behaviour |
|---|---|
| Account creation | `users.volume_landmarks` defaults to `{}` — no copy of defaults at signup |
| Settings load | defaults ← stored, per field; now migrated on read |
| **Settings save** | writes the WHOLE merged object back, so presence is useless as a customization signal |
| Rollover hydration | `resolveVolumeLandmarks` merges per field, complete triples only |
| Client hydration | `userStore.getVolumeLandmarks`, then enhanced scaling |
| Local persistence | zustand `persist`, key `user-storage` |
| Reset | copies the whole default table for the experience level |

Because presence cannot distinguish customization, migration is by VALUE,
per scalar field.

## v1 → v2 delta (the entire change set)

| Cell | Before | After |
|---|---|---|
| `intermediate.triceps_lat_med.mrv` | 20 | 18 |
| `advanced.triceps_lat_med.mrv` | 24 | 22 |

## Field-level migration examples

| Stored (advanced `triceps_lat_med`) | Result | Why |
|---|---|---|
| `{8, 15, 24}` | `{8, 15, 22}` | every field still at its v1 default → all advance |
| `{12, 15, 24}` | `{12, 15, 22}` | MEV customized and preserved; MRV still default → advances |
| `{8, 15, 30}` | `{8, 15, 30}` | MRV customized → preserved |
| `{8, 15, 20}` | `{8, 15, 22}` | 20 is the *intermediate* v1 default → recognized as untouched (experience changed) |

Rare accepted ambiguity: a hand-entered value equal to another experience
level's old default for the same muscle+field is indistinguishable from an
untouched default and migrates. With a two-cell delta the blast radius is
negligible.

## Learned recovery multiplier

Application bounds narrowed 0.70–1.50 → 0.85–1.35. Policy: **clamp on read**
(`clampRecoveryMultiplier` already ran on load and inside the window
derivation). No destructive UPDATE. The DB numeric CHECK stays 0.7–1.5 so
older clients keep working; the next learning step writes an in-range value.

Production distribution was NOT accessible from this environment (no
credentials). Run this to check it:

```sql
SELECT muscle_group,
       COUNT(*) FILTER (WHERE recovery_multiplier < 0.85) AS below_new_min,
       COUNT(*) FILTER (WHERE recovery_multiplier > 1.35) AS above_new_max,
       COUNT(*) AS total
FROM user_muscle_recovery_multipliers
GROUP BY muscle_group
ORDER BY (below_new_min + above_new_max) DESC;
```

## Database vocabulary migration

`20260802000001_recovery_multiplier_full_muscle_vocabulary.sql` extends the
`muscle_group` CHECK from 20 keys to all 26. The six missing keys
(`upper_traps`, `mid_lower_traps`, `gastrocnemius`, `soleus`, `triceps_long`,
`triceps_lat_med`) could not be persisted at all, so soreness learning was
silently dead for them. Rows are preserved; the numeric range is untouched;
`recoveryMultiplierVocabulary.test.ts` parses the migration and pins it to
`STANDARD_MUSCLE_GROUPS`.

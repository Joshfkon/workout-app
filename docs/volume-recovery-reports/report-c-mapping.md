# Report C — Mapping report

Which reference governs which operation, per coarse group.

`referenceDirectMRV` is UNAVAILABLE at group level for chest / back /
shoulders — they have no same-name detailed parent row, and a group direct
MRV is deliberately NOT manufactured by summing children.

## `chest`

- Mapped detailed rows: `chest_upper`, `chest_lower`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): **unavailable** (no same-name detailed parent)
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.chest` = 22
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `back`

- Mapped detailed rows: `lats`, `upper_back`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): **unavailable** (no same-name detailed parent)
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.back` = 25
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `shoulders`

- Mapped detailed rows: `front_delts`, `lateral_delts`, `rear_delts`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): **unavailable** (no same-name detailed parent)
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.shoulders` = 26
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `biceps`

- Mapped detailed rows: `biceps`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `biceps` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.biceps` = 26
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `triceps`

- Mapped detailed rows: `triceps`, `triceps_long`, `triceps_lat_med`
- Group-capacity row: `triceps`
- Bounded components: `triceps_long`, `triceps_lat_med`
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: completePartition
- Aggregation: complete over disjoint buckets — the coarse row is capped per-exercise group credit, NOT Σ(children)
- referenceDirectMRV (group level): available — `triceps` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.triceps` = 24
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `quads`

- Mapped detailed rows: `quads`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `quads` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.quads` = 20
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `hamstrings`

- Mapped detailed rows: `hamstrings`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `hamstrings` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.hamstrings` = 20
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `glutes`

- Mapped detailed rows: `glutes`, `glute_med`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `glutes` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.glutes` = 24
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `calves`

- Mapped detailed rows: `calves`, `gastrocnemius`, `soleus`
- Group-capacity row: `calves`
- Bounded components: `gastrocnemius`, `soleus`
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: completePartition
- Aggregation: complete over disjoint buckets — the coarse row is capped per-exercise group credit, NOT Σ(children)
- referenceDirectMRV (group level): available — `calves` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.calves` = 20
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `abs`

- Mapped detailed rows: `abs`, `obliques`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `abs` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.abs` = 20
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `traps`

- Mapped detailed rows: `traps`, `upper_traps`, `mid_lower_traps`
- Group-capacity row: `traps`
- Bounded components: `upper_traps`, `mid_lower_traps`
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: partialRollup
- Aggregation: complete over disjoint buckets — the coarse row is capped per-exercise group credit, NOT Σ(children)
- referenceDirectMRV (group level): available — `traps` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.traps` = 20
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.
- **Unresolved overlap:** the detailed taxonomy has no mid-trap key, and `rhomboids` maps to `upper_back` (the BACK group), so trapezius stimulus provably leaks outside this group. Classified `partialRollup` for that reason.

## `forearms`

- Mapped detailed rows: `forearms`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `forearms` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.forearms` = 14
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `adductors`

- Mapped detailed rows: `adductors`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `adductors` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.adductors` = 12
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

## `erectors`

- Mapped detailed rows: `erectors`
- Group-capacity row: — (no parent/component family)
- Bounded components: —
- Credit semantics: primary credit resolves standard-first (a coarse tag credits ONLY the coarse row); secondary credit at SECONDARY_MUSCLE_CREDIT. Rows are **credit-disjoint**.
- Anatomical relationship: independent
- Aggregation: complete
- referenceDirectMRV (group level): available — `erectors` detailed row
- referenceInclusiveMRV: `RESEARCH_VOLUME_BANDS.erectors` = 12
- Governing reference — display/warnings/group budget/generator clamp: **inclusive**; direct-set logic, component bounds, Bug 6 capacity: **direct**.

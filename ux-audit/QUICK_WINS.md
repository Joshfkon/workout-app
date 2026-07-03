# Quick Wins — each under an hour

Ordered by payoff. File references verified against source.

1. **Fix the hydration bug** — `components/ui/LoadingAnimation.tsx:48-53`: move the `Math.random()` animation pick into a `useEffect` (render `'pulse'` first). Kills console errors + forced client re-renders on history, mesocycle, templates, exercises, body-composition, coaching, settings. *(30 min, biggest single win in this file)*

2. **Wire the plate calculator** — state exists (`workout/[id]/page.tsx:301-302`), prop exists (`ExerciseCard.tsx:199`). Add a small "⚖" button beside the weight stepper calling `onPlateCalculatorOpen(weightKg)`. *(45 min)*

3. **Format muscle names** — "Lateral_delts" renders raw in the workout header, exercise picker, and volume rows. One `formatMuscleName()` (replace `_`, title-case) applied at the display sites. *(20 min)*

4. **Use `formatWeight()` on social surfaces** — feed cards and leaderboards hardcode kg ("14468 kg" shown to a lbs user). `lib/utils.formatWeight(v, unit)` already exists. *(30 min)*

5. **Fix "Top 1% of 1 lifters"** — leaderboards percentile copy: suppress percentile when cohort < 10 ("1 of 1 this week"). *(15 min)*

6. **Remove dev copy from login** — "For testing: create an account or use Supabase dashboard" (`app/(auth)/login/page.tsx:110-115`). *(5 min)*

7. **Humanize auth errors** — map Supabase strings ("missing email or phone", "Invalid login credentials") to friendly copy at `login/page.tsx:29`. *(20 min)*

8. **Label the icon-only tabs** — Analytics (5 emoji tabs) and Settings (4 icon tabs): add 10px text labels. *(30 min)*

9. **Add Profile / Discover / Leaderboards / Pricing to the More page** — they're unreachable today (`dashboard/more/page.tsx:23-31`). *(15 min)*

10. **"HyperTracker" → "HyperTrack"** — onboarding welcome (`onboarding/page.tsx`) and science page hero. *(10 min)*

11. **Guard the phantom continue card** — Home/Train "Continue workout" should ignore sessions with 0 blocks & 0 sets (or auto-discard them). Pairs with the real P0 fix for GET-created sessions. *(45 min for the guard; the route fix is separate)*

12. **Per-page `<title>`s** — every route currently shares one title; add `metadata`/`generateMetadata` per dashboard page. *(45 min)*

13. **Hide "Press Enter to send" hint on touch devices** — AI coach composer. *(10 min)*

14. **Replace native `confirm()`/`alert()` in history bulk-delete** with the existing `ConfirmModal`. *(30 min)*

15. **Number polish** — "2175.0 lbs total" → drop trailing `.0`; widen the weight stepper value so "57.5 lbs" doesn't truncate to "57.5 …". *(20 min)*

16. **Fix volume-page 406s** — Supabase `.single()` on possibly-empty results → `.maybeSingle()`. *(15 min)*

17. **Merge landing CTAs** — "Get Started" and "Create Account" both go to /register; keep one, make the other "Log in". *(10 min)*

18. **Drop the Confirm-Password field** on register; add a show-password eye toggle. *(30 min)*

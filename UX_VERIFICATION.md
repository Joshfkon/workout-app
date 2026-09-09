# Custom Exercise Creation UX - Verification Guide

## Overview
This document outlines how to verify the UX improvements to the custom exercise creation flow.

## Changes Summary

### 1. Review Form - Default to "Save AI Defaults"
**Before:** Advanced details always visible/required to review
**After:** Advanced details collapsed by default with clear "Save" CTA

### 2. AI Failure Fallback
**Before:** Error with only Retry/Cancel options
**After:** Error with "Retry AI completion" AND "Save with basics only" options

### 3. Mid-Workout Flow
**Status:** Already working correctly - verified in code

---

## Test Scenarios

### Test 1: Happy Path (AI Succeeds)

**Steps:**
1. Navigate to `/dashboard/exercises/add` OR open a workout and click "Create custom exercise"
2. Fill in Phase 1 - Basic Form:
   - Name: "Seated Cable Row"
   - Primary Muscle: "Lats"
   - Equipment: "Cable"
   - (Optional) Description: "Seated row with cable machine"
3. Click "Continue"
4. Wait for AI completion

**Expected Results:**
- ✅ Review page shows summary card with:
  - Exercise name and equipment
  - Grid showing: Primary muscle, Type, Rep range, Hypertrophy tier, Difficulty
- ✅ "Adjust advanced details (optional)" button is visible and COLLAPSED
- ✅ Primary CTA is "Save Exercise" button (enabled)
- ✅ Clicking "Save Exercise" immediately saves without requiring accordion expansion
- ✅ If from workout: exercise is added to the workout and both modals close
- ✅ If from /exercises/add page: navigates to /dashboard/exercises

### Test 2: Low Confidence AI Result

**Steps:**
1. Create exercise with unusual name: "Weird Hybrid Movement Thing"
2. Primary Muscle: "Chest"
3. Equipment: "Other"
4. Description: "It's complicated"
5. Continue through to review

**Expected Results:**
- ✅ Review page appears
- ✅ If AI confidence is "low", a warning/notice may appear
- ✅ Summary card still shows with basic info
- ✅ Advanced details remain collapsed (user can expand if they want to check/adjust)
- ✅ "Save Exercise" button still works

### Test 3: AI Failure - Save with Basics

**Steps:**
1. Start creating custom exercise
2. Fill in basic info:
   - Name: "My Custom Deadlift Variation"
   - Primary Muscle: "Hamstrings"
   - Equipment: "Barbell"
3. Click "Continue"
4. **Simulate AI Failure:**
   - Option A: Disconnect from internet momentarily
   - Option B: If testing with rate-limited API key, hit the limit
   - Option C: Look for error in console/network tab

**Expected Results:**
- ✅ Error message displays at top in red danger box
- ✅ Two buttons appear:
  1. "Retry AI completion" (gray/secondary)
  2. "Save with basics only" (blue/primary)
- ✅ Clicking "Retry AI completion" attempts AI completion again
- ✅ Clicking "Save with basics only" saves exercise with defaults:
  - Uses provided name, muscle, equipment
  - Sets: compound mechanic, 8-12 rep range, RIR 2, moderate fatigue
  - B-tier hypertrophy score
  - No form cues or advanced metadata
- ✅ Exercise saves successfully and user proceeds to next step

### Test 4: Mid-Workout Creation

**Steps:**
1. Start or resume a workout session
2. Click "+ Add Exercise" button
3. Click "Create custom exercise" at bottom of picker
4. Complete creation (either AI path or basics-only path)
5. Exercise name: "Test Workout Exercise"
6. Save the exercise

**Expected Results:**
- ✅ Custom exercise modal opens within workout context
- ✅ After saving (either with AI or basics-only):
  - Exercise is immediately added to the current workout
  - Exercise appears as a new block in the workout
  - Custom exercise modal closes
  - Add exercise picker closes
  - User is back at the workout view with new exercise ready to log sets
- ✅ Exercise name appears in the workout block list

### Test 5: Power User - Advanced Editing

**Steps:**
1. Create custom exercise with any valid basic info
2. Wait for AI completion (review page)
3. Click "Adjust advanced details (optional)" button

**Expected Results:**
- ✅ Button expands to show all accordions:
  - Muscles (secondary, stabilizers)
  - Movement Properties
  - Loading & Progression
  - Safety & Injury Considerations
  - Hypertrophy Rating
  - Form Cues
- ✅ All editing controls are functional
- ✅ Can modify any field
- ✅ Changes are saved when clicking "Save Exercise"
- ✅ Clicking button again collapses the accordions

### Test 6: AI Fallback Notice

**Steps:**
1. If AI source is 'fallback' (offline/error), check the review page

**Expected Results:**
- ✅ Orange/warning box displays with message:
  - "AI review didn't run — these are defaults"
  - Explanation that muscle assignments weren't reviewed
- ✅ User can still save
- ✅ Exercise is flagged for AI review on Exercises page

---

## Visual Verification Checklist

### Review Page Layout (AI Success)
```
┌─────────────────────────────────────┐
│         Ready to save               │
│  AI completed the exercise details  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Exercise Name                       │
│ Seated Cable Row                    │
│                                     │
│ Equipment: Cable                    │
└─────────────────────────────────────┘

┌────────────┬────────────┬──────────┐
│ Primary    │ Type       │ Rep      │
│ muscle     │ Compound   │ range    │
│ Lats       │            │ 8-12     │
└────────────┴────────────┴──────────┘
┌────────────┬────────────┬──────────┐
│ Hyper-     │ Difficulty │          │
│ trophy     │ Intermediate│         │
│ A-tier     │            │          │
└────────────┴────────────┴──────────┘

┌─────────────────────────────────────┐
│ ▼ Adjust advanced details (optional)│
└─────────────────────────────────────┘

┌─────────────┬──────────────────────┐
│   Back      │   Save Exercise      │
└─────────────┴──────────────────────┘
```

### Error Page (AI Failure)
```
┌─────────────────────────────────────┐
│ ⚠ AI limit reached                  │
│                                     │
│ ┌───────────────────────────────┐  │
│ │ Retry AI completion           │  │
│ └───────────────────────────────┘  │
│ ┌───────────────────────────────┐  │
│ │ Save with basics only         │  │
│ └───────────────────────────────┘  │
└─────────────────────────────────────┘

[Phase 1 Form remains visible below]
```

---

## Regression Testing

Ensure these existing features still work:

- ✅ Variation of existing exercise
- ✅ Multi-gym location availability selection
- ✅ Duplicate exercise detection and "Use this instead" flow
- ✅ All validation errors display correctly
- ✅ Back button returns to Phase 1 with data preserved
- ✅ Cancel button closes modal/navigates back

---

## Success Criteria

All test scenarios pass with expected results:
- [ ] Test 1: Happy Path (AI Succeeds)
- [ ] Test 2: Low Confidence AI Result
- [ ] Test 3: AI Failure - Save with Basics
- [ ] Test 4: Mid-Workout Creation
- [ ] Test 5: Power User - Advanced Editing
- [ ] Test 6: AI Fallback Notice

Design adherence:
- [ ] Uses existing design system colors/spacing
- [ ] Mobile responsive
- [ ] Accessible keyboard navigation
- [ ] No layout shifts or visual bugs

Performance:
- [ ] No new console errors
- [ ] Saves complete in < 2 seconds
- [ ] No unnecessary re-renders

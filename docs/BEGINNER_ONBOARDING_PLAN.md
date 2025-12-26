# Beginner-Friendly Onboarding & Education Plan

> **Status**: Phase 1 & 2 Complete
> **Last Updated**: 2025-12-26
> **Branch**: `claude/beginner-onboarding-hxjJW`

This document outlines the comprehensive plan to make HyperTrack more accessible to beginners by simplifying advanced features and adding contextual explanations throughout the user journey.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Core Principles](#core-principles)
4. [Implementation Phases](#implementation-phases)
5. [Detailed Feature Specifications](#detailed-feature-specifications)
6. [Component Inventory](#component-inventory)
7. [Success Metrics](#success-metrics)
8. [Technical Considerations](#technical-considerations)

---

## Executive Summary

### Problem Statement

HyperTrack is a science-based hypertrophy training app with powerful features, but it currently:
- Uses terminology without explanation (MEV, MAV, MRV, RPE, RIR, FFMI, E1RM)
- Collects data without explaining how it will be used
- Buries educational content in a Learn section most users won't find
- Assumes familiarity with periodization and progressive overload concepts
- Shows complex analytics without interpretation guidance

### Solution Overview

Implement a **progressive disclosure education system** that:
1. Explains concepts at the point of use (not in separate documentation)
2. Uses plain language with optional "science mode" for advanced users
3. Shows the "why" before asking for the "what"
4. Celebrates progress while educating on next steps
5. Adapts explanations based on user experience level

---

## Current State Analysis

### Onboarding Flow (4 Steps)

| Step | Current | Gap |
|------|---------|-----|
| **1. Units** | Simple unit selection | Good - no changes needed |
| **2. Body Composition** | Sex, height, weight, body fat %, FFMI display | Missing: Why we need this, what FFMI means practically |
| **3. Benchmark Selection** | Core/optional lifts, time estimate | Missing: Why benchmarks matter, how data will be used |
| **4. Strength Calibration** | RPE-based testing, percentile display | Missing: What RPE/RIR means, why calibration helps |
| **5. Completion** | Strength profile, imbalances | Good foundation but could celebrate more |

### Key Concepts Not Explained

| Concept | Where Used | Current Explanation | Needed |
|---------|------------|---------------------|--------|
| **MEV/MAV/MRV** | Dashboard, volume tracker | None in UI | Tooltip + first-use walkthrough |
| **RPE/RIR** | Calibration, workout logging | Button labels only | Interactive explainer |
| **FFMI** | Onboarding body comp | Bracket labels | Practical interpretation |
| **E1RM** | Analytics, progression | None | Plain-language description |
| **Set Quality** | Progression engine | Calculated silently | Show feedback during workout |
| **Periodization** | Mesocycle builder | None | Phase explanations |
| **Strength Percentiles** | Calibration results | Visual only | Interpretation text |

### Existing Educational Assets

- **Learn Hub**: 7+ detailed articles (5-8 min reads each)
- **Visual Guides**: Body fat % selector with images
- **Percentile Charts**: Segmented bar visualizations
- **Strength Badges**: Emoji-based level indicators

**Problem**: These exist but aren't surfaced at the right moments.

---

## Core Principles

### 1. Explain Before You Ask

> "Before we ask for your body fat percentage, tell you why it matters"

Every data collection point should be preceded by context explaining:
- What we're asking for
- Why it helps personalize your training
- How it will be used downstream

### 2. Progressive Disclosure

> "Show simple by default, reveal complexity on demand"

- **Level 1**: Plain language summary (default for beginners)
- **Level 2**: Detailed explanation (tap to expand)
- **Level 3**: Science deep-dive (link to Learn article)

### 3. Just-In-Time Education

> "Teach concepts when they become relevant, not before"

- Don't explain periodization during onboarding
- Explain it when creating first mesocycle
- Remind during phase transitions

### 4. Celebrate Progress with Context

> "You did great AND here's what that means"

- Show achievements with interpretation
- Connect numbers to practical outcomes
- Suggest next steps

### 5. Adapt to Experience Level

> "Novices need guidance, experts want efficiency"

- Track `showBeginnersGuide` preference
- Allow "Skip explanation" for advanced users
- Remember dismissed tooltips

---

## Implementation Phases

### Phase 1: Onboarding Enhancement (Priority: Critical) - COMPLETE

**Goal**: Make the first 10 minutes crystal clear

#### 1.1 Pre-Onboarding Welcome Screen
- [ ] Add welcome modal explaining HyperTrack's approach
- [ ] Set expectations: "We'll ask a few questions to personalize your training"
- [ ] Estimated time: 5-7 minutes
- [ ] Skip option for returning users

#### 1.2 Body Composition Context
- [x] Add "Why we ask" collapsible before body comp form (`ContextCard`)
- [x] Explain FFMI in plain terms (`ExplainedTerm` with tooltip)
- [x] Add interpretation after FFMI calculation: "This means..."
- [ ] Improve body fat visual guide (add female images)

#### 1.3 Benchmark Selection Explanation
- [x] Add intro section: "Why we test your strength" (`ContextCard`)
- [x] Explain: "These tests help us recommend the right weights for ALL exercises"
- [ ] Show preview of what personalization looks like
- [ ] Better time estimate with what each test involves

#### 1.4 Calibration Walkthrough
- [x] Add RPE/RIR explainer modal before first test (`RPEExplainer`)
- [x] Interactive "What does RIR feel like?" guide (quiz included)
- [ ] Show real-time feedback: "Great! Based on this, you can likely bench X lbs"
- [x] Explain percentile results in plain language

#### 1.5 Completion Screen Enhancement
- [x] Add "What we learned about you" summary (`InlineHint`)
- [x] Score interpretation based on value
- [x] Interactive "What's next" section with previews
- [ ] Optional onboarding tour of dashboard

### Phase 2: Contextual Tooltips System (Priority: High) - COMPLETE

**Goal**: Add help at every complex UI element

#### 2.1 Create Reusable Tooltip Components
- [x] `<InfoTooltip>` - Simple "?" icon with popover
- [ ] `<LearnMoreLink>` - Links to Learn article with preview (deferred)
- [x] `<FirstTimeHint>` - One-time educational callout
- [ ] `<ConceptExplainer>` - Multi-level progressive disclosure (deferred)

#### 2.2 Dashboard Tooltips
- [x] Volume tracker: MEV/MAV/MRV tooltips in VolumeChart legend
- [x] Atrophy risk alert: MEV tooltip next to badge
- [x] Weekly volume card: FirstTimeHint explaining volume tracking
- [x] Nutrition card: FirstTimeHint explaining macro tracking
- [x] Mesocycle creation: FirstTimeHint explaining mesocycles

#### 2.3 Workout Screen Tooltips
- [x] RIR selector: InfoTooltip explaining "Reps In Reserve"
- [x] Form rating: InfoTooltip explaining "Form Quality"
- [x] Set input target: RIR tooltip in target display
- [ ] Weight recommendations: Explain how calculated (deferred)
- [ ] Rest timer: Why rest matters for hypertrophy (deferred)

#### 2.4 Settings UI
- [x] Education preferences card in settings page
- [x] "Show Beginner Tips" toggle
- [x] "Explain Science Terms" toggle
- [x] "Reset Tips" button to restore dismissed hints

### Phase 3: Guided Feature Introduction (Priority: High)

**Goal**: Walk users through advanced features when they first encounter them

#### 3.1 First Mesocycle Creation
- [ ] Step-by-step wizard with explanations
- [ ] Explain periodization phases in plain terms
- [ ] Show what each week will look like
- [ ] Set expectations for deload week

#### 3.2 First Workout
- [ ] Optional guided workout mode
- [ ] Explain each screen section
- [ ] Highlight where to log RIR
- [ ] Show how to use rest timer

#### 3.3 First Week Review
- [ ] Interpret weekly volume data
- [ ] Explain what optimal progress looks like
- [ ] Celebrate effective sets
- [ ] Guide on adjustments

### Phase 4: Settings & Preferences (Priority: Medium) - PARTIAL

**Goal**: Let users control their education experience

#### 4.1 Experience Level Selection
- [ ] Add clear "I'm new to training" vs "I'm experienced" choice
- [ ] Explain what changes based on selection
- [ ] Allow changing later in settings

#### 4.2 Education Preferences - COMPLETE
- [x] "Show beginner tips" toggle (in Settings page)
- [x] "Explain science terms" toggle (in Settings page)
- [x] "Reset all tips" button (in Settings page)
- [ ] Notification preferences for educational content (deferred)

#### 4.3 Terminology Glossary
- [ ] Searchable glossary in settings
- [ ] Quick access from any tooltip
- [ ] Links to relevant Learn articles

### Phase 5: In-App Coaching Messages (Priority: Medium)

**Goal**: Proactive guidance throughout the user journey

#### 5.1 Contextual Coach Messages
- [ ] Pre-workout: "Today's focus is..."
- [ ] During workout: "Great set! You're in the optimal range"
- [ ] Post-workout: "You completed X effective sets for chest"
- [ ] Weekly: "This week your volume was..."

#### 5.2 Milestone Celebrations
- [ ] First workout completed
- [ ] First week completed
- [ ] First mesocycle completed
- [ ] New strength PR
- [ ] Optimal volume achieved

#### 5.3 Gentle Corrections
- [ ] Below MEV warning with action
- [ ] Approaching MRV caution
- [ ] Long rest between workouts
- [ ] Skipped muscle group

### Phase 6: Learn Hub Integration (Priority: Low)

**Goal**: Surface existing content at the right moments

#### 6.1 Contextual Article Suggestions
- [ ] After viewing FFMI: "Want to learn more about body composition?"
- [ ] After mesocycle creation: "Understand periodization"
- [ ] After plateau detection: "Breaking through plateaus"

#### 6.2 Learn Hub Improvements
- [ ] Add "Getting Started" section for beginners
- [ ] Create "Quick Concepts" (1-min reads) alongside deep dives
- [ ] Add video/animation support for complex concepts

---

## Detailed Feature Specifications

### Spec 1: InfoTooltip Component

**Purpose**: Provide contextual help for any UI element

```tsx
interface InfoTooltipProps {
  term: string;                    // e.g., "MEV"
  shortExplanation: string;        // 1-2 sentences
  learnMoreSlug?: string;          // Link to Learn article
  level?: 'beginner' | 'all';      // Show only for beginners?
  dismissable?: boolean;           // Can user hide permanently?
}
```

**Behavior**:
- Appears as small "?" icon next to term
- Click/tap opens popover with explanation
- "Learn more" links to full article
- Respects user's education preferences

**Example Usage**:
```tsx
<div className="flex items-center gap-1">
  <span>MEV Target: 6 sets</span>
  <InfoTooltip
    term="MEV"
    shortExplanation="Minimum Effective Volume - the fewest sets per week needed to maintain muscle. Below this, you risk losing progress."
    learnMoreSlug="adaptive-volume"
  />
</div>
```

### Spec 2: FirstTimeHint Component

**Purpose**: One-time educational callouts for new features

```tsx
interface FirstTimeHintProps {
  id: string;                      // Unique ID for tracking dismissal
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

**Behavior**:
- Appears once per user per hint ID
- Stored in localStorage or user preferences
- Can be reset via settings
- Respects "show beginner tips" preference

### Spec 3: Onboarding Context Cards

**Purpose**: Explain why we're asking for data before each section

**Structure**:
```tsx
interface ContextCardProps {
  icon: ReactNode;
  title: string;                   // e.g., "Why we measure your strength"
  points: string[];                // Bullet points of benefits
  collapsible?: boolean;           // Allow hiding after first view
}
```

**Locations**:
1. Before body composition form
2. Before benchmark selection
3. Before calibration tests
4. Before mesocycle creation

### Spec 4: RPE/RIR Interactive Explainer

**Purpose**: Teach the RPE scale through interactive examples

**Flow**:
1. Show scale visualization (1-10)
2. Explain in plain terms: "How many more reps could you do?"
3. Interactive quiz: "Watch this video - how hard was that set?"
4. Practice with sample scenarios
5. Confidence check before proceeding

**Content**:
| RIR | RPE | Description | Example |
|-----|-----|-------------|---------|
| 4+  | 6   | Warm-up feel, very controlled | "I could do many more reps" |
| 3   | 7   | Moderate effort, form perfect | "Getting harder but still easy" |
| 2   | 8   | Challenging, could do 2 more | "Effort is real, form is solid" |
| 1   | 9   | Very hard, maybe 1 more | "One more would be tough" |
| 0   | 10  | Maximum effort, nothing left | "Could not do another rep" |

### Spec 5: Volume Landmark Explainer

**Purpose**: Help users understand MEV/MAV/MRV

**Visual**: Traffic light metaphor
- 🔴 Below MEV: "Danger zone - not enough to maintain"
- 🟢 MEV to MAV: "Growth zone - optimal for progress"
- 🟡 MAV to MRV: "Caution zone - high volume, monitor fatigue"
- 🔴 Above MRV: "Danger zone - too much to recover from"

**Personalization**:
- Show user's specific numbers based on experience level
- Explain why their numbers differ from others
- Connect to weekly volume tracker

### Spec 6: Strength Profile Interpretation

**Purpose**: Make percentile data meaningful

**Example Output**:
```
Your Bench Press: 75th percentile among trained lifters

What this means:
You can bench more than 75% of people who train regularly.
This is considered "Intermediate" level.

For your body composition (FFMI 22.5):
This is excellent pressing strength relative to your muscle mass.
```

**Include**:
- Plain language percentile explanation
- Experience level classification
- Body composition context
- Comparison interpretation
- Actionable insight

---

## Component Inventory

### New Components Created (Phase 1)

| Component | Location | Status |
|-----------|----------|--------|
| `InfoTooltip` | `/components/ui/InfoTooltip.tsx` | **DONE** |
| `ExplainedTerm` | `/components/ui/InfoTooltip.tsx` | **DONE** |
| `FirstTimeHint` | `/components/ui/FirstTimeHint.tsx` | **DONE** |
| `InlineHint` | `/components/ui/FirstTimeHint.tsx` | **DONE** |
| `ContextCard` | `/components/onboarding/ContextCard.tsx` | **DONE** |
| `ContextBanner` | `/components/onboarding/ContextCard.tsx` | **DONE** |
| `WelcomeCard` | `/components/onboarding/ContextCard.tsx` | **DONE** |
| `RPEExplainer` | `/components/onboarding/RPEExplainer.tsx` | **DONE** |
| `RPEQuickReference` | `/components/onboarding/RPEExplainer.tsx` | **DONE** |

### Components to Create (Future Phases)

| Component | Location | Priority |
|-----------|----------|----------|
| `ConceptExplainer` | `/components/ui/ConceptExplainer.tsx` | High |
| `VolumeLandmarkVisual` | `/components/education/VolumeLandmarkVisual.tsx` | Medium |
| `GuidedTour` | `/components/ui/GuidedTour.tsx` | Medium |
| `CoachMessage` | `/components/coaching/CoachMessage.tsx` | Medium |
| `MilestoneModal` | `/components/ui/MilestoneModal.tsx` | Low |

### Modified Components (Phase 1)

| Component | File | Changes Made |
|-----------|------|--------------|
| Onboarding Body Comp | `/app/(onboarding)/onboarding/page.tsx` | Added ContextCard, ExplainedTerm for FFMI |
| Benchmark Selection | `/onboarding/benchmarks/page.tsx` | Added ContextCard explaining purpose |
| Calibration Page | `/onboarding/calibrate/page.tsx` | Added RPE modal, ContextCard, percentile explanation |
| Completion Screen | `/onboarding/complete/page.tsx` | Added InlineHint, score interpretation, ExplainedTerm |

### Modified Components (Phase 2)

| Component | File | Changes Made |
|-----------|------|--------------|
| Dashboard Page | `/app/(dashboard)/dashboard/page.tsx` | Added FirstTimeHint to volume, nutrition, mesocycle cards |
| Volume Chart | `/components/analytics/VolumeChart.tsx` | Added InfoTooltip for MEV/MAV/MRV legend |
| Atrophy Risk Alert | `/components/analytics/AtrophyRiskAlert.tsx` | Added InfoTooltip for MEV badge |
| Set Input Row | `/components/workout/SetInputRow.tsx` | Added InfoTooltip for RIR target |
| RIR Selector | `/components/workout/RIRSelector.tsx` | Added InfoTooltip for RIR label |
| Form Rating Selector | `/components/workout/FormRatingSelector.tsx` | Added InfoTooltip for Form Quality |
| Settings Page | `/app/(dashboard)/dashboard/settings/page.tsx` | Added EducationPreferencesCard |

### Components to Modify (Future Phases)

| Component | File | Changes Needed |
|-----------|------|----------------|
| Workout Screen | Various | Add weight recommendation explanations |
| Rest Timer | `/components/workout/RestTimer.tsx` | Add rest importance tooltip |

### New Hooks Created (Phase 1)

| Hook | Purpose | Status |
|------|---------|--------|
| `useEducationStore` | Zustand store for education preferences | **DONE** |
| `useEducationPreferences` | Hook for education settings | **DONE** |
| `useFirstTimeHint` | Track which hints have been dismissed | **DONE** |
| `useGuidedTour` | Manage multi-step tour state | **DONE** |

### New Types Created

| File | Purpose |
|------|---------|
| `/types/education.ts` | Education types, tooltip content library, RIR explanations |

### User Preferences Additions

```typescript
interface UserPreferences {
  // Existing...

  // New education preferences
  showBeginnerTips: boolean;        // Default: true for new users
  explainScienceTerms: boolean;     // Default: true
  dismissedHints: string[];         // IDs of dismissed hints
  completedTours: string[];         // IDs of completed guided tours
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
}
```

---

## Success Metrics

### Quantitative

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Onboarding completion rate | Unknown | >80% | Analytics |
| Time to first workout | Unknown | <24 hours | Analytics |
| First-week retention | Unknown | >60% | Analytics |
| Feature discovery rate | Unknown | >50% for core features | Analytics |
| Help article views | Low | +100% | Analytics |

### Qualitative

- Users can explain what MEV/MAV/MRV means in their own words
- Users understand why they did calibration tests
- Users feel confident navigating the dashboard
- Users know where to find help when confused
- Reduced support requests about basic concepts

---

## Technical Considerations

### State Management

Education preferences should be:
1. Stored in Zustand `userStore` for immediate access
2. Persisted to Supabase for cross-device sync
3. Cached in localStorage for offline access

### Performance

- Lazy-load Learn article content
- Preload tooltips for current screen only
- Use skeleton loaders for educational content
- Keep tooltip content lightweight (<1KB each)

### Accessibility

- All tooltips keyboard accessible
- Screen reader announcements for hints
- Sufficient color contrast for educational highlights
- Alternative text for visual explanations

### Localization

- Design content system for easy translation
- Keep explanations concise (easier to translate)
- Use universal concepts where possible
- Avoid idioms and cultural references

---

## File Structure

```
/components
  /education                    # New education-specific components
    VolumeLandmarkVisual.tsx
    RPEScale.tsx
    PercentileExplainer.tsx
  /onboarding                   # Enhanced onboarding components
    ContextCard.tsx
    RPEExplainer.tsx
    WelcomeModal.tsx
  /ui
    InfoTooltip.tsx
    FirstTimeHint.tsx
    ConceptExplainer.tsx
    GuidedTour.tsx

/hooks
  useEducationPreferences.ts
  useFirstTimeHint.ts
  useGuidedTour.ts

/lib
  /education                    # Education content and utilities
    tooltipContent.ts           # All tooltip text content
    tourSteps.ts                # Guided tour step definitions
    milestones.ts               # Milestone definitions

/types
  education.ts                  # Education-related types
```

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Create detailed designs for Phase 1 components
3. [ ] Implement InfoTooltip and FirstTimeHint base components
4. [ ] Enhance onboarding flow with context cards
5. [ ] Add RPE/RIR explainer to calibration
6. [ ] Test with beginner users for feedback
7. [ ] Iterate based on feedback
8. [ ] Roll out remaining phases

---

## Appendix: Content Templates

### Tooltip Content Template

```typescript
export const TOOLTIP_CONTENT = {
  MEV: {
    term: "MEV (Minimum Effective Volume)",
    short: "The minimum sets per week to maintain muscle. Below this, you risk losing progress.",
    long: "Research shows that training below MEV leads to gradual muscle loss. Your MEV is personalized based on your experience level.",
    learnMore: "/learn/adaptive-volume"
  },
  // ...
};
```

### Context Card Template

```typescript
export const CONTEXT_CARDS = {
  bodyComposition: {
    icon: "📊",
    title: "Why we measure your body composition",
    points: [
      "Helps us understand your current muscle mass",
      "Calculates your personalized nutrition targets",
      "Tracks your progress beyond just weight",
      "Sets realistic goals based on your physique"
    ]
  },
  // ...
};
```

---

*This document should be updated as implementation progresses and user feedback is gathered.*

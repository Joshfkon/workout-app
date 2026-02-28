# CLAUDE.md - AI Assistant Guide for HyperTrack

This document provides essential context for AI assistants working on the HyperTrack codebase.

## Project Overview

HyperTrack is a science-based hypertrophy training app with intelligent auto-regulation. It helps users track workouts, manage training volume, and optimize progression using evidence-based methodologies.

### Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: TailwindCSS with custom design system
- **Database**: Supabase (PostgreSQL + Auth)
- **State Management**: Zustand (with persist middleware)
- **Charts**: Recharts
- **Animations**: Framer Motion
- **AI Coaching**: Anthropic Claude API
- **Payments**: Stripe
- **Mobile**: Capacitor (iOS & Android)
- **Testing**: Jest 30 + React Testing Library

## Project Structure

```
/app                    # Next.js App Router pages
  /(auth)              # Auth routes (login, register, forgot/reset password)
  /(dashboard)         # Protected dashboard routes (main app)
    /dashboard
      /analytics       # Analytics and progress charts
      /body-composition # Body comp tracking (DEXA, measurements)
      /discover        # Discover shared workouts
      /feed            # Social activity feed
      /glossary        # Training terminology
      /history         # Workout history
      /learn           # Educational content (exercise science, RPE, etc.)
      /mesocycle       # Mesocycle planning
      /nutrition       # Nutrition tracking
      /pricing         # Subscription plans
      /settings        # User settings
      /templates       # Workout templates
      /workout         # Active workout sessions
  /(onboarding)        # User onboarding flow
  /api                 # API routes
    /integrations      # Wearable integrations (Fitbit)
    /stripe            # Payment webhooks and checkout

/components            # React components
  /analytics           # Charts (E1RMGraph, VolumeChart, FFMIGauge, WeightGraph)
  /coaching            # AI coaching UI (ImbalanceAlert, PercentileChart, StrengthLevelBadge)
  /dashboard           # Dashboard cards (ActivityCard, CardioTracker, MuscleRecoveryCard)
  /exercises           # Exercise management (CreateCustomExercise, FormCuesEditor)
  /nutrition           # Nutrition (MacroCalculator, BarcodeScanner, TDEEDashboard)
  /providers           # React providers (ServiceWorker, NativeAppBehavior, SplashProvider)
  /settings            # Settings components (ImportExport, GymEquipment, MusclePriority)
  /social              # Social features
    /feed              # Activity feed (ReactionBar, CommentSection)
    /follow            # Follow system
    /leaderboards      # Leaderboard tables and rankings
    /profile           # User profiles and avatars
    /sharing           # Workout sharing
  /subscription        # Subscription UI (UpgradePrompt, PricingCard)
  /ui                  # Base UI (Button, Card, Modal, Input, Toggle, Accordion)
  /wearables           # Wearable integration (WearableConnectionsScreen)
  /workout             # Workout components (SetInputRow, RestTimer, ExerciseCard, PlateCalculator)

/hooks                 # Custom React hooks
  useActiveWorkout.ts  # Active workout session state
  useActivityFeed.ts   # Social activity feed
  useAdaptiveVolume.ts # Adaptive volume tracking
  useBestLifts.ts      # Personal records
  useComments.ts       # Social comments
  useEducationPreferences.ts # Learning preferences
  useExerciseHistory.ts # Historical exercise data
  useExercisePreferences.ts # User exercise preferences
  useFollow.ts         # Social follow system
  useLeaderboard.ts    # Leaderboard data
  useMuscleRecovery.ts # Muscle recovery status
  useProgressionTargets.ts # Progression engine integration
  usePWA.ts            # PWA detection and features
  useReactions.ts      # Social reactions
  useRestTimer.ts      # Rest timer functionality
  useSharedWorkouts.ts # Shared workout discovery
  useSubscription.ts   # Subscription status
  useSupabase.ts       # Supabase client hook
  useUserPreferences.ts # User preferences with unit conversion
  useWeeklyVolume.ts   # Volume tracking per muscle group
  useWorkoutTimer.ts   # Workout duration timer

/lib                   # Utilities and integrations
  /actions             # Server actions (coaching, nutrition, tdee, wearable)
  /body-composition    # P-ratio calculations
  /content             # Static content (learnContent)
  /exercises           # Exercise AI completion
  /integrations        # Wearable integrations (Fitbit, HealthKit, Google Fit)
  /migrations          # Data migrations (bodyweight sets, set feedback)
  /nutrition           # TDEE and macro calculations (adaptive, dynamic targets)
  /supabase            # Supabase client (server.ts, client.ts, middleware.ts)
  /training            # Training logic (coachingService, exercise-safety, programEngine)
  /utils               # Utility modules (pwa-detection)
  errors.ts            # Error handling utilities
  social.ts            # Social features utilities
  stripe.ts            # Stripe integration
  subscription.ts      # Subscription utilities
  utils.ts             # Common utilities (weight conversion, date formatting)
  validation.ts        # Input validation
  weightUtils.ts       # Weight-specific utilities
  workout-sharing.ts   # Workout sharing utilities

/services              # Pure business logic (NO database calls)
  bodyCompEngine.ts    # Body composition analysis (FFMI)
  bodyProportionsAnalytics.ts # Body proportions analysis
  bodyweightService.ts # Bodyweight exercise handling
  coachingContextService.ts # AI coaching context
  coachingEngine.ts    # AI coaching logic
  deloadEngine.ts      # Deload recommendations
  discomfortTracker.ts # Pain/discomfort tracking
  equipmentFilter.ts   # Equipment-based exercise filtering
  exercisePreferencesService.ts # Exercise preference management
  exerciseSafety.ts    # Exercise safety checks
  exerciseService.ts   # Exercise data service
  exerciseSwapper.ts   # Exercise swap suggestions
  fatigueBudgetEngine.ts # Fatigue budget calculations
  fatigueEngine.ts     # Readiness and fatigue tracking
  fatSecretService.ts  # FatSecret API integration
  goalPresets.ts       # Goal-based presets
  importExport.ts      # Data import/export
  injuryAwareSwapper.ts # Injury-aware exercise swapping
  measurementImbalanceEngine.ts # Muscle imbalance detection
  mesocycleBuilder.ts  # Mesocycle program generation
  openFoodFactsService.ts # OpenFoodFacts API
  performanceTracker.ts # Performance metrics
  plateauDetector.ts   # Plateau detection algorithms
  progressionEngine.ts # Auto-progression calculations
  regionalAnalysis.ts  # Regional body composition
  repRangeEngine.ts    # Rep range recommendations
  rpeCalibration.ts    # RPE calibration
  sanityChecks.ts      # Data sanity checks
  sessionBuilderWithFatigue.ts # Fatigue-aware session building
  setPrescription.ts   # Set prescription logic
  usdaService.ts       # USDA food database
  volumeTracker.ts     # Weekly volume calculations
  weightEstimationEngine.ts # Weight estimation for new exercises

/stores                # Zustand state stores
  exerciseStore.ts     # Exercise library cache
  userStore.ts         # User profile and preferences
  workoutStore.ts      # Active workout session state

/types                 # TypeScript interfaces
  coaching.ts          # AI coaching types
  database.ts          # Supabase database types
  database-queries.ts  # Database query types
  education.ts         # Educational content types
  nutrition.ts         # Nutrition tracking types
  schema.ts            # Core domain types (User, Exercise, SetLog, etc.)
  social.ts            # Social feature types
  templates.ts         # Workout template types
  training.ts          # Training-specific types
  user-exercise-preferences.ts # Exercise preference types
  wearable.ts          # Wearable integration types

/supabase              # Database migrations and seeds
  /migrations          # SQL migration files (chronologically ordered)
  seed.sql             # Exercise library seed data

/docs                  # Documentation
  BEGINNER_ONBOARDING_PLAN.md
  EXERCISE_VIDEOS_SETUP.md
  MACRO_CALCULATOR_V3.3_INTEGRATION.md
  SOCIAL_FEATURES_PLAN.md
  SOCIAL_FEATURES_SETUP.md
  SOCIAL_FEATURES_STATUS.md
```

## Key Concepts

### Volume Landmarks
The app tracks training volume using research-based landmarks:
- **MEV** (Minimum Effective Volume): Minimum sets to maintain muscle
- **MAV** (Maximum Adaptive Volume): Optimal training zone
- **MRV** (Maximum Recoverable Volume): Upper limit before excessive fatigue

### Progression Hierarchy
The `progressionEngine.ts` uses this hierarchy:
1. **Load progression**: Increase weight when hitting rep targets
2. **Rep progression**: Add reps before increasing weight
3. **Set progression**: Add sets within mesocycle
4. **Technique progression**: Maintain for consolidation

### Set Quality Classification
Based on RPE analysis in `types/schema.ts`:
- **Junk**: RPE <= 5 (too easy, not stimulative)
- **Effective**: RPE 6-7 (contributing to volume)
- **Stimulative**: RPE 7.5-9.5 (optimal for hypertrophy)
- **Excessive**: RPE 10 (may impair recovery)

### Set Feedback System
Users provide structured feedback per set:
- **RIR (Reps In Reserve)**: 4+ = Easy, 2-3 = Good, 1 = Hard, 0 = Maxed Out
- **Form Rating**: clean, some_breakdown, ugly
- **Discomfort**: Optional pain/discomfort logging by body part

### Hypertrophy Scoring
Based on Jeff Nippard's methodology, exercises are rated:
- **Tier**: S (best) through F (worst) for hypertrophy
- **Stretch Under Load**: 1-5 rating for lengthened position tension
- **Resistance Profile**: 1-5 rating for consistent resistance
- **Progression Ease**: 1-5 rating for overload potential

### Periodization Phases
- **Hypertrophy**: Higher reps, moderate intensity
- **Strength**: Lower reps, higher intensity
- **Peaking**: Very low reps, highest intensity
- **Deload**: Reduced volume and intensity for recovery

## Development Commands

```bash
# Development
npm run dev          # Start development server (localhost:3000)

# Testing
npm test             # Run Jest tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report

# Build & Lint
npm run build        # Build for production
npm run lint         # Run ESLint

# Database (Supabase)
npx supabase start   # Start local Supabase
npx supabase db push # Push migrations
npx supabase db reset # Reset and reseed database

# Mobile (Capacitor)
npm run cap:sync     # Sync web assets to native projects
npm run cap:ios      # Open iOS project in Xcode
npm run cap:android  # Open Android project in Android Studio
npm run cap:run:ios  # Build and run on iOS device/simulator
npm run cap:run:android # Build and run on Android device/emulator
npm run cap:livereload:ios # Run iOS with live reload
npm run cap:livereload:android # Run Android with live reload
```

## Code Conventions

### TypeScript Patterns

1. **All weights stored in kg**: Convert for display using `lib/utils.ts`:
   ```typescript
   import { formatWeight, inputWeightToKg } from '@/lib/utils';

   // Display: formatWeight(weightKg, userPreference.units)
   // Storage: inputWeightToKg(inputValue, 'lb') -> kg
   ```

2. **Date handling**: Use local timezone, not UTC:
   ```typescript
   import { getLocalDateString } from '@/lib/utils';

   // YYYY-MM-DD in local timezone
   const today = getLocalDateString();
   ```

3. **Services are pure functions**: No database calls in `/services`. Pass data as input:
   ```typescript
   // GOOD: Pure function
   export function calculateNextTargets(input: CalculateNextTargetsInput): ProgressionTargets

   // BAD: Database call inside service
   export async function calculateNextTargets(userId: string) { /* db call */ }
   ```

4. **Type imports from schema.ts**: Use the canonical types:
   ```typescript
   import type { SetLog, Exercise, ProgressionTargets } from '@/types/schema';
   ```

### Component Patterns

1. **Path aliases**: Use `@/` prefix for absolute imports:
   ```typescript
   import { Button } from '@/components/ui';
   import { useUserStore } from '@/stores';
   ```

2. **Zustand stores**: Use selectors to minimize re-renders:
   ```typescript
   const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');
   ```

3. **Server Components vs Client Components**:
   - Dashboard pages are mostly Server Components
   - Interactive components use `'use client'` directive
   - Data fetching happens at the page level

### Database Patterns

1. **Supabase client creation**:
   - Server: `import { createClient } from '@/lib/supabase/server'`
   - Client: `import { createClient } from '@/lib/supabase/client'`

2. **Row Level Security (RLS)**: All tables use RLS. User data filtered by `user_id`.

3. **Migration naming**: `YYYYMMDD000XXX_description.sql`

## Testing Guidelines

Tests are located in `__tests__` directories or as `.test.ts(x)` files.

### Coverage Requirements (from jest.config.js)

| File/Module | Lines | Functions | Branches | Statements |
|-------------|-------|-----------|----------|------------|
| `lib/utils.ts` | 55% | 40% | 75% | 55% |
| `services/progressionEngine.ts` | 70% | 60% | 50% | 70% |
| `services/volumeTracker.ts` | 70% | 60% | 50% | 70% |
| `services/fatigueEngine.ts` | 70% | 60% | 50% | 70% |
| `services/plateauDetector.ts` | 70% | 60% | 50% | 70% |
| `services/deloadEngine.ts` | 70% | 60% | 50% | 70% |
| `services/exerciseSwapper.ts` | 70% | 60% | 50% | 70% |
| `services/mesocycleBuilder.ts` | 70% | 60% | 50% | 70% |
| `services/bodyCompEngine.ts` | 70% | 60% | 50% | 70% |

### Test Patterns
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Use the user-event library for interactions
const user = userEvent.setup();
await user.click(screen.getByRole('button'));
```

## Key Files to Understand

| File | Purpose |
|------|---------|
| `services/progressionEngine.ts` | Core progression logic, set quality, warmup protocols |
| `services/fatigueEngine.ts` | Readiness and fatigue tracking |
| `services/volumeTracker.ts` | Weekly volume calculations per muscle |
| `services/mesocycleBuilder.ts` | Mesocycle program generation |
| `services/injuryAwareSwapper.ts` | Exercise swapping considering injuries |
| `types/schema.ts` | All domain types and enums |
| `lib/utils.ts` | Weight conversion, date formatting utilities |
| `stores/userStore.ts` | User state and preferences management |
| `lib/supabase/middleware.ts` | Session handling for auth |
| `app/(dashboard)/layout.tsx` | Protected route wrapper |

## Common Tasks

### Adding a New Exercise Field
1. Update `types/schema.ts` (Exercise interface)
2. Update `types/database.ts` (database types)
3. Create migration in `supabase/migrations/`
4. Update affected services and components

### Adding a New Muscle Group
1. Update `MUSCLE_GROUPS` const in `types/schema.ts`
2. Update `DEFAULT_VOLUME_LANDMARKS` for all experience levels
3. Add to exercise seed data if needed

### Creating a New Dashboard Page
1. Create page at `app/(dashboard)/dashboard/[name]/page.tsx`
2. Page is Server Component by default
3. Use client components for interactive parts

### Adding a New Service
1. Create file in `/services` directory
2. Keep it as pure functions (no DB calls)
3. Add corresponding types in `/types` if needed
4. Add tests in `/services/__tests__/`
5. Add coverage threshold in `jest.config.js`

### Working with Social Features
1. Check `/components/social` for UI components
2. Use hooks: `useFollow`, `useReactions`, `useComments`, `useActivityFeed`
3. Types are in `types/social.ts`
4. See `docs/SOCIAL_FEATURES_*.md` for detailed documentation

## Environment Variables

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI Coaching (Elite tier)
ANTHROPIC_API_KEY=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Mobile (Capacitor)
NEXT_PUBLIC_APP_URL=  # Production URL for Capacitor

# Wearables (optional)
FITBIT_CLIENT_ID=
FITBIT_CLIENT_SECRET=
```

## Important Warnings

1. **Never expose server-side keys**: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and `ANTHROPIC_API_KEY` are server-only

2. **Weight units**: Always store in kg, convert only for display

3. **RIR/RPE conversion**: The app uses RIR (Reps In Reserve) for user input but converts to RPE internally. See `rirToRpe()` in `types/schema.ts`

4. **Pure services**: `/services` files must not import Supabase client or make API calls

5. **Bodyweight exercises**: Use `effectiveLoadKg` (bodyweight +/- modifications) for progression tracking

6. **Database constraints**: Check migrations for constraints (e.g., reps have upper bounds of 999)

## CI/CD

GitHub Actions workflow (`.github/workflows/test.yml`):
- Runs on push/PR to main/master
- Node.js 20
- Runs `npm test` and coverage checks
- Uploads coverage reports as artifacts

## Mobile App (Capacitor)

The app supports iOS and Android via Capacitor:
- **App ID**: `app.hypertrack.workout`
- **Web Dir**: `out` (static export)
- **Production URL**: `https://hypertrack.app`

### Native Features
- Push notifications
- Status bar customization
- Splash screen with dark theme (#0a0a0a)
- Deep linking via custom scheme `HyperTrack://`

### Development Workflow
1. Make changes to the web app
2. Build: `npm run build`
3. Sync: `npm run cap:sync`
4. Test: `npm run cap:run:ios` or `npm run cap:run:android`
5. For live development: `npm run cap:livereload:ios`

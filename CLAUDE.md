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
- **AI Coaching**: Anthropic Claude API
- **Payments**: Stripe
- **Testing**: Jest + React Testing Library

## Project Structure

```
/app                    # Next.js App Router pages
  /(auth)              # Auth routes (login, register, forgot/reset password)
  /(dashboard)         # Protected dashboard routes (main app)
  /(onboarding)        # User onboarding flow
  /api                 # API routes (Stripe, Fitbit integration)

/components            # React components
  /analytics           # Charts and analytics (E1RMGraph, VolumeChart, FFMIGauge)
  /coaching            # AI coaching UI (ImbalanceAlert, PercentileChart)
  /dashboard           # Dashboard cards (ActivityCard, CardioTracker)
  /exercises           # Exercise management (CreateCustomExercise, FormCuesEditor)
  /nutrition           # Nutrition tracking (MacroCalculator, BarcodeScanner)
  /ui                  # Base UI components (Button, Card, Modal, Input)
  /wearables           # Wearable integration (WearableConnectionsScreen)
  /workout             # Workout-specific (SetInputRow, RestTimer, ExerciseCard)

/hooks                 # Custom React hooks
  useActiveWorkout.ts  # Active workout session state
  useExerciseHistory.ts # Historical exercise data
  useProgressionTargets.ts # Progression engine integration
  useRestTimer.ts      # Rest timer functionality
  useUserPreferences.ts # User preferences with unit conversion
  useWeeklyVolume.ts   # Volume tracking per muscle group

/lib                   # Utilities and integrations
  /actions             # Server actions (coaching, nutrition, tdee)
  /exercises           # Exercise AI completion
  /integrations        # Wearable integrations (Fitbit, HealthKit, Google Fit)
  /nutrition           # TDEE and macro calculations
  /supabase            # Supabase client (server.ts, client.ts, middleware.ts)
  /training            # Training logic (coachingService, exercise-safety)
  utils.ts             # Common utilities (weight conversion, date formatting)

/services              # Pure business logic (NO database calls)
  progressionEngine.ts # Auto-progression calculations
  fatigueEngine.ts     # Readiness and fatigue tracking
  volumeTracker.ts     # Weekly volume calculations
  plateauDetector.ts   # Plateau detection algorithms
  exerciseSwapper.ts   # Exercise swap suggestions
  deloadEngine.ts      # Deload recommendations
  bodyCompEngine.ts    # Body composition analysis (FFMI)
  mesocycleBuilder.ts  # Mesocycle program generation

/stores                # Zustand state stores
  userStore.ts         # User profile and preferences
  workoutStore.ts      # Active workout session state
  exerciseStore.ts     # Exercise library cache

/types                 # TypeScript interfaces
  schema.ts            # Core domain types (User, Exercise, SetLog, etc.)
  database.ts          # Supabase database types
  training.ts          # Training-specific types
  nutrition.ts         # Nutrition tracking types

/supabase              # Database migrations and seeds
  /migrations          # SQL migration files (chronologically ordered)
  seed.sql             # Exercise library seed data
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

### Coverage Requirements
- `lib/utils.ts`: 55% lines, 40% functions, 75% branches
- Tests focus on unit conversion and preference handling

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
```

## Important Warnings

1. **Never expose server-side keys**: `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` are server-only

2. **Weight units**: Always store in kg, convert only for display

3. **RIR/RPE conversion**: The app uses RIR (Reps In Reserve) for user input but converts to RPE internally. See `rirToRpe()` in `types/schema.ts`

4. **Pure services**: `/services` files must not import Supabase client or make API calls

5. **Bodyweight exercises**: Use `effectiveLoadKg` (bodyweight +/- modifications) for progression tracking

## CI/CD

GitHub Actions workflow (`.github/workflows/test.yml`):
- Runs on push/PR to main/master
- Node.js 20
- Runs `npm test` and coverage checks
- Uploads coverage reports as artifacts

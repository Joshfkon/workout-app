# HyperTrack - Intelligent Workout Tracker

A science-based hypertrophy training app with intelligent auto-regulation, built with Next.js 14, Supabase, and TypeScript.

## Features

- **AI Coaching**: Get personalized training advice based on your actual workout data, body composition, and training phase
- **Volume Tracking**: Monitor sets per muscle group against personalized MEV/MAV/MRV landmarks
- **Auto Progression**: Intelligent weight and rep recommendations based on your performance
- **Fatigue Management**: Pre-workout readiness checks and smart deload recommendations
- **Plateau Detection**: Identify stalled exercises and get actionable suggestions
- **Exercise Library**: 50+ exercises with form cues, common mistakes, and setup notes
- **Body Composition Tracking**: DEXA scan tracking with FFMI calculations and regional analysis
- **Strength Calibration**: Benchmark lift testing with percentile rankings

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: TailwindCSS with custom design system
- **Database**: Supabase (PostgreSQL + Auth)
- **State Management**: Zustand
- **Charts**: Recharts

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for local Supabase)

### Installation

1. Clone the repository:
```bash
git clone <repo-url>
cd workout-app
```

2. Install dependencies:
```bash
npm install
```

3. Start local Supabase:
```bash
npx supabase start
```

4. Copy environment variables:
```bash
cp .env.local.example .env.local
```

5. Update `.env.local` with your Supabase and API credentials (from `supabase start` output):
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# For AI Coaching feature (Elite tier)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key
```

6. Run database migrations:
```bash
npx supabase db push
```

7. Seed the exercise library:
```bash
npx supabase db reset
```

8. Start the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Project Structure

```
/app                    # Next.js App Router pages
  /(auth)              # Auth routes (login, register)
  /(dashboard)         # Protected dashboard routes
/components            # React components
  /ui                  # Base UI components
  /workout             # Workout-specific components
  /analytics           # Charts and analytics
/hooks                 # Custom React hooks
/lib                   # Utilities and Supabase client
/services              # Pure business logic
  progressionEngine.ts # Auto-progression calculations
  fatigueEngine.ts     # Readiness and fatigue tracking
  volumeTracker.ts     # Weekly volume calculations
  plateauDetector.ts   # Plateau detection algorithms
  exerciseSwapper.ts   # Exercise swap suggestions
/stores                # Zustand state stores
/types                 # TypeScript interfaces
/supabase              # Database migrations and seeds
```

## Key Concepts

### Volume Landmarks
- **MEV** (Minimum Effective Volume): Minimum sets to maintain muscle
- **MAV** (Maximum Adaptive Volume): Optimal training zone
- **MRV** (Maximum Recoverable Volume): Upper limit before excessive fatigue

### Progression Hierarchy
1. **Load progression**: Increase weight when hitting rep targets
2. **Rep progression**: Add reps before increasing weight
3. **Set progression**: Add sets within mesocycle
4. **Technique progression**: Maintain for consolidation

### Set Quality Classification
- **Junk**: RPE ≤ 5 (too easy, not stimulative)
- **Effective**: RPE 6-7 (contributing to volume)
- **Stimulative**: RPE 7.5-9.5 (optimal for hypertrophy)
- **Excessive**: RPE 10 (may impair recovery)

## Database Schema

The app uses these main tables:
- `users` - User profiles with preferences and volume landmarks
- `exercises` - Exercise library with metadata
- `mesocycles` - Training blocks (4-8 weeks)
- `workout_sessions` - Individual workouts
- `exercise_blocks` - Exercises within a session with targets
- `set_logs` - Logged sets with quality classification
- `exercise_performance_snapshots` - Historical performance for progress tracking
- `weekly_muscle_volume` - Aggregated weekly volume per muscle
- `plateau_alerts` - Detected plateaus with suggestions
- `training_phases` - Cut/bulk/maintain phase tracking with goals
- `ai_coaching_conversations` - AI coaching conversation history
- `dexa_scans` - Body composition tracking
- `calibrated_lifts` - Strength benchmarks with percentile rankings

## License

MIT


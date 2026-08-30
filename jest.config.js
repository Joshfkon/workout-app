// Default the suite to a negative-offset timezone unless the caller pins one.
// Running in UTC hides the entire local-vs-UTC day-boundary bug class (an
// 11 PM local weigh-in "moving" to tomorrow); a real offset makes those bugs
// fail loudly. Set BEFORE workers spawn so Date sees it from process start.
// See lib/date/__tests__/localDayStrings.test.ts.
process.env.TZ = process.env.TZ || 'America/Denver';

const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // next/jest applies next.config.js modularizeImports, rewriting
    // `import { X } from 'recharts'` to 'recharts/es6/X' — a path only the
    // production build resolves (optimizePackageImports supersedes it there).
    // Map the rewritten specifiers back to the package so components that
    // render charts are testable; jest.mock('recharts') also applies to them.
    '^recharts/es6/.*$': 'recharts',
  },
  testMatch: [
    '**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)',
    '**/*.(test|spec).(ts|tsx|js|jsx)',
  ],
  // Ignore git worktrees (.claude/worktrees/*) which contain full duplicate
  // copies of the repo and otherwise double/triple-count every test.
  // fix-suggestion-engine/ is a one-off verification harness (writes artifacts),
  // not part of the product test suite — run it explicitly, not in CI.
  // simulation/cli is the `npm run simulate` entry point: it runs the whole
  // harness suite and is invoked explicitly, never as part of `npm test`.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/worktrees/',
    '/fix-suggestion-engine/',
    '/simulation/cli/',
  ],
  collectCoverageFrom: [
    'lib/utils.ts',
    'lib/nutrition/**/*.ts',
    'hooks/useUserPreferences.ts',
    'components/**/*.tsx',
    'services/**/*.ts',
    '!components/**/*.test.tsx',
    '!services/**/*.test.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    'lib/utils.ts': {
      lines: 55,
      functions: 40,
      branches: 75,
      statements: 55,
    },
    'services/volumeProjection.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/plannedVolumeProjection.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/exerciseOrdering.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/volumeTrendsData.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/workoutDurationEstimator.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/livePrDetector.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/exerciseFilter.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/equipmentClass.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/exerciseDetailAnalytics.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/progressionEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/progressionHealth.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/warmupEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/nutritionCalendar.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/muscleRecovery.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/weeklyProgressionEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/volumeTracker.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/effectiveVolume.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/fatigueEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/plateauDetector.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/shared/trend.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/shared/motion/pipeline.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/shared/motion/captureAnalysis.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/shared/motion/butterworth.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/shared/motion/stillness.ts': {
      lines: 80,
      functions: 80,
      branches: 65,
      statements: 80,
    },
    'services/shared/motion/observations.ts': {
      lines: 90,
      functions: 85,
      branches: 75,
      statements: 90,
    },
    'services/shared/motion/autoGate.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/shared/motion/calibration.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/shared/motion/segmentation.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/progressionInsights.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/deloadEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/exerciseSwapper.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/plannedRecovery.ts': {
      lines: 90,
      functions: 90,
      branches: 80,
      statements: 90,
    },
    'services/equipmentFilter.ts': {
      lines: 90,
      functions: 80,
      branches: 85,
      statements: 90,
    },
    'services/mesocycleBuilder.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/bodyCompEngine.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/compositionSpace.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/waistTrend.ts': {
      lines: 85,
      functions: 80,
      branches: 70,
      statements: 85,
    },
    'services/intakePacing.ts': {
      lines: 90,
      functions: 80,
      branches: 80,
      statements: 90,
    },
    'services/suggestedWorkout.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/workoutShareText.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/locationSubstitution.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
    'services/locationProfiles.ts': {
      lines: 70,
      functions: 60,
      branches: 50,
      statements: 70,
    },
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);

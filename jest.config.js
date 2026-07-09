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
  testPathIgnorePatterns: ['/node_modules/', '/.claude/worktrees/'],
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
    'services/progressionEngine.ts': {
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

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
  },
  testMatch: [
    '**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)',
    '**/*.(test|spec).(ts|tsx|js|jsx)',
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
    'services/progressionEngine.ts': {
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
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);

/**
 * Tests for lib/errors.ts
 */

import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  ServerError,
  NotFoundError,
  RateLimitError,
  categorizeError,
  getErrorMessage,
  isRetryable,
  withRetry,
  tryCatch,
} from '../errors';

// ============================================
// ERROR CLASSES TESTS
// ============================================

describe('AppError', () => {
  it('creates error with category and message', () => {
    const error = new AppError('Test error', 'validation');

    expect(error.message).toBe('Test error');
    expect(error.category).toBe('validation');
    expect(error.name).toBe('AppError');
  });

  it('sets default user message based on category', () => {
    const error = new AppError('Internal error', 'server');

    expect(error.userMessage).toBe('Something went wrong on our end. Please try again.');
  });

  it('allows custom user message', () => {
    const error = new AppError('Internal error', 'server', {
      userMessage: 'Custom message',
    });

    expect(error.userMessage).toBe('Custom message');
  });

  it('sets retryable based on category', () => {
    expect(new AppError('Error', 'network').retryable).toBe(true);
    expect(new AppError('Error', 'server').retryable).toBe(true);
    expect(new AppError('Error', 'validation').retryable).toBe(false);
    expect(new AppError('Error', 'authentication').retryable).toBe(false);
  });
});

describe('ValidationError', () => {
  it('creates validation error with field', () => {
    const error = new ValidationError('Invalid email', { field: 'email' });

    expect(error.category).toBe('validation');
    expect(error.field).toBe('email');
    expect(error.retryable).toBe(false);
    expect(error.statusCode).toBe(400);
  });

  it('supports validation details', () => {
    const error = new ValidationError('Multiple errors', {
      details: { email: 'Invalid format', password: 'Too short' },
    });

    expect(error.details).toEqual({
      email: 'Invalid format',
      password: 'Too short',
    });
  });
});

describe('AuthenticationError', () => {
  it('creates auth error with defaults', () => {
    const error = new AuthenticationError();

    expect(error.category).toBe('authentication');
    expect(error.statusCode).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toBe('Please sign in to continue.');
  });
});

describe('NetworkError', () => {
  it('creates network error that is retryable', () => {
    const error = new NetworkError('Connection failed');

    expect(error.category).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toContain('internet connection');
  });

  it('preserves cause', () => {
    const cause = new Error('Original error');
    const error = new NetworkError('Connection failed', cause);

    expect(error.cause).toBe(cause);
  });
});

describe('NotFoundError', () => {
  it('creates error with resource info', () => {
    const error = new NotFoundError('Workout', 'workout-123');

    expect(error.category).toBe('not_found');
    expect(error.resourceType).toBe('Workout');
    expect(error.resourceId).toBe('workout-123');
    expect(error.message).toContain('Workout not found');
    expect(error.statusCode).toBe(404);
  });
});

describe('RateLimitError', () => {
  it('creates rate limit error with retry delay', () => {
    const error = new RateLimitError(5000);

    expect(error.category).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(5000);
    expect(error.retryable).toBe(true);
    expect(error.statusCode).toBe(429);
  });
});

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe('categorizeError', () => {
  it('returns AppError unchanged', () => {
    const original = new ValidationError('Test');
    const result = categorizeError(original);

    expect(result).toBe(original);
  });

  it('categorizes network errors', () => {
    const error = new Error('Network request failed');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(NetworkError);
  });

  it('categorizes auth errors', () => {
    const error = new Error('Unauthorized access');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(AuthenticationError);
  });

  it('categorizes not found errors', () => {
    const error = new Error('Resource not found');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(NotFoundError);
  });

  it('defaults to ServerError for unknown errors', () => {
    const error = new Error('Something weird happened');
    const result = categorizeError(error);

    expect(result).toBeInstanceOf(ServerError);
  });

  it('handles non-Error values', () => {
    const result = categorizeError('string error');

    expect(result).toBeInstanceOf(ServerError);
    expect(result.message).toBe('string error');
  });
});

describe('getErrorMessage', () => {
  it('returns user message from AppError', () => {
    const error = new ValidationError('Internal message', {
      userMessage: 'User-friendly message',
    });

    expect(getErrorMessage(error)).toBe('User-friendly message');
  });

  it('categorizes and returns message for plain errors', () => {
    const error = new Error('fetch failed');

    expect(getErrorMessage(error)).toContain('internet connection');
  });
});

describe('isRetryable', () => {
  it('returns true for network errors', () => {
    expect(isRetryable(new NetworkError())).toBe(true);
  });

  it('returns false for validation errors', () => {
    expect(isRetryable(new ValidationError('bad input'))).toBe(false);
  });

  it('categorizes and checks plain errors', () => {
    expect(isRetryable(new Error('network failed'))).toBe(true);
    expect(isRetryable(new Error('unauthorized'))).toBe(false);
  });
});

// ============================================
// RETRY LOGIC TESTS
// ============================================

describe('withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns result on success', async () => {
    const fn = jest.fn().mockResolvedValue('success');

    const promise = withRetry(fn);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue('success');

    const promise = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

    // First attempt fails
    await jest.advanceTimersByTimeAsync(0);

    // Wait for retry delay
    await jest.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts', async () => {
    jest.useRealTimers(); // Use real timers for this test

    const fn = jest.fn().mockRejectedValue(new NetworkError('Always fails'));

    const promise = withRetry(fn, { maxAttempts: 2, initialDelayMs: 10 }); // Short delay

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new ValidationError('bad input'));

    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toBeInstanceOf(ValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback', async () => {
    const onRetry = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue('success');

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      onRetry,
    });

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(100);
    await promise;

    expect(onRetry).toHaveBeenCalledWith(expect.any(NetworkError), 1, 100);
  });
});

// ============================================
// RESULT TYPE TESTS
// ============================================

describe('tryCatch', () => {
  it('returns success result on success', async () => {
    const fn = jest.fn().mockResolvedValue('data');

    const result = await tryCatch(fn);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('data');
    }
  });

  it('returns error result on failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('failed'));

    const result = await tryCatch(fn);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AppError);
    }
  });
});

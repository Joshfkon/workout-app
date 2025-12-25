/**
 * Standardized error handling utilities for HyperTrack
 *
 * Usage:
 * - Use AppError subclasses for typed error handling
 * - Use withRetry() for operations that may fail transiently
 * - Use getErrorMessage() for user-friendly error messages
 */

// ============================================
// ERROR TYPES
// ============================================

export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'network'
  | 'server'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'unknown';

/**
 * Base application error with category and user-friendly message
 */
export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly userMessage: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    category: ErrorCategory,
    options?: {
      userMessage?: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'AppError';
    this.category = category;
    this.userMessage = options?.userMessage ?? getDefaultUserMessage(category);
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? isRetryableCategory(category);
    this.cause = options?.cause;
  }
}

/**
 * Validation error for invalid user input
 */
export class ValidationError extends AppError {
  readonly field?: string;
  readonly details?: Record<string, string>;

  constructor(
    message: string,
    options?: {
      field?: string;
      details?: Record<string, string>;
      userMessage?: string;
    }
  ) {
    super(message, 'validation', {
      userMessage: options?.userMessage ?? 'Please check your input and try again.',
      statusCode: 400,
      retryable: false,
    });
    this.name = 'ValidationError';
    this.field = options?.field;
    this.details = options?.details;
  }
}

/**
 * Authentication error - user not logged in
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Please sign in to continue.') {
    super(message, 'authentication', {
      userMessage: message,
      statusCode: 401,
      retryable: false,
    });
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error - user lacks permission
 */
export class AuthorizationError extends AppError {
  constructor(message = 'You don\'t have permission to perform this action.') {
    super(message, 'authorization', {
      userMessage: message,
      statusCode: 403,
      retryable: false,
    });
    this.name = 'AuthorizationError';
  }
}

/**
 * Network error - connection issues
 */
export class NetworkError extends AppError {
  constructor(message = 'Network connection failed', cause?: Error) {
    super(message, 'network', {
      userMessage: 'Unable to connect. Please check your internet connection.',
      retryable: true,
      cause,
    });
    this.name = 'NetworkError';
  }
}

/**
 * Server error - backend issues
 */
export class ServerError extends AppError {
  constructor(message = 'Server error', statusCode = 500, cause?: Error) {
    super(message, 'server', {
      userMessage: 'Something went wrong on our end. Please try again.',
      statusCode,
      retryable: statusCode >= 500,
      cause,
    });
    this.name = 'ServerError';
  }
}

/**
 * Not found error - resource doesn't exist
 */
export class NotFoundError extends AppError {
  readonly resourceType?: string;
  readonly resourceId?: string;

  constructor(
    resourceType?: string,
    resourceId?: string,
    message?: string
  ) {
    const defaultMessage = resourceType
      ? `${resourceType} not found${resourceId ? `: ${resourceId}` : ''}`
      : 'Resource not found';

    super(message ?? defaultMessage, 'not_found', {
      userMessage: resourceType
        ? `The requested ${resourceType.toLowerCase()} could not be found.`
        : 'The requested resource could not be found.',
      statusCode: 404,
      retryable: false,
    });
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends AppError {
  readonly retryAfterMs?: number;

  constructor(retryAfterMs?: number) {
    super('Rate limit exceeded', 'rate_limit', {
      userMessage: 'Too many requests. Please wait a moment and try again.',
      statusCode: 429,
      retryable: true,
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getDefaultUserMessage(category: ErrorCategory): string {
  switch (category) {
    case 'validation':
      return 'Please check your input and try again.';
    case 'authentication':
      return 'Please sign in to continue.';
    case 'authorization':
      return 'You don\'t have permission to perform this action.';
    case 'network':
      return 'Unable to connect. Please check your internet connection.';
    case 'server':
      return 'Something went wrong on our end. Please try again.';
    case 'not_found':
      return 'The requested resource could not be found.';
    case 'conflict':
      return 'This action conflicts with another operation. Please refresh and try again.';
    case 'rate_limit':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

function isRetryableCategory(category: ErrorCategory): boolean {
  return ['network', 'server', 'rate_limit'].includes(category);
}

/**
 * Categorize an unknown error into an AppError
 */
export function categorizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      return new NetworkError(error.message, error);
    }

    if (message.includes('unauthorized') || message.includes('unauthenticated')) {
      return new AuthenticationError();
    }

    if (message.includes('forbidden') || message.includes('permission')) {
      return new AuthorizationError();
    }

    if (message.includes('not found') || message.includes('404')) {
      return new NotFoundError();
    }

    if (message.includes('rate limit') || message.includes('too many')) {
      return new RateLimitError();
    }

    // Default to server error for unknown Error instances
    return new ServerError(error.message, 500, error);
  }

  // For non-Error values
  return new ServerError(String(error));
}

/**
 * Get a user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  const appError = categorizeError(error);
  return appError.userMessage;
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  const appError = categorizeError(error);
  return appError.retryable;
}

// ============================================
// RETRY LOGIC
// ============================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 16000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if an error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Execute an async function with exponential backoff retry
 *
 * @example
 * const data = await withRetry(
 *   () => fetchUserData(userId),
 *   { maxAttempts: 3, initialDelayMs: 1000 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 16000,
    backoffMultiplier = 2,
    shouldRetry = (error) => isRetryable(error),
    onRetry,
  } = options;

  let lastError: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      const canRetry = !isLastAttempt && shouldRetry(error, attempt);

      if (!canRetry) {
        throw categorizeError(error);
      }

      // Handle rate limit errors with specific retry delay
      if (error instanceof RateLimitError && error.retryAfterMs) {
        delayMs = error.retryAfterMs;
      }

      onRetry?.(error, attempt, delayMs);

      await sleep(delayMs);
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  throw categorizeError(lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// RESULT TYPE (for explicit error handling)
// ============================================

export type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Wrap a promise in a Result type for explicit error handling
 *
 * @example
 * const result = await tryCatch(() => saveWorkout(data));
 * if (!result.success) {
 *   showError(result.error.userMessage);
 *   return;
 * }
 * showSuccess(result.data);
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: categorizeError(error) };
  }
}

/**
 * Synchronous version of tryCatch
 */
export function tryCatchSync<T>(fn: () => T): Result<T> {
  try {
    const data = fn();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: categorizeError(error) };
  }
}

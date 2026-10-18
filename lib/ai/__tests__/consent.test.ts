/**
 * Third-party AI data sharing consent (App Store Review Guideline 5.1.2(i)).
 * The gate must only open on an explicit TRUE, and the AI actions must not
 * construct a provider client when it is closed.
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createUntypedServerClient: jest.fn(),
}));

const mockAnthropic = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: function Anthropic(...args: unknown[]) {
    return mockAnthropic(...args);
  },
}));

const mockOpenAI = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: function OpenAI(...args: unknown[]) {
    return mockOpenAI(...args);
  },
}));

import { createClient, createUntypedServerClient } from '@/lib/supabase/server';
import { AI_CONSENT_REQUIRED_MESSAGE, hasAiDataSharingConsent } from '@/lib/ai/consent';
import { parseMealDescription } from '@/lib/actions/nutrition-ai';
import { reviewWorkoutPlan } from '@/lib/actions/workoutPlanReview';
import type { ReviewPayload } from '@/services/workoutSetup/aiReview';

/** Supabase stub: a signed-in user whose users row has the given consent. */
function stubSupabase(consent: boolean | null, readError: unknown = null) {
  const single = jest.fn().mockResolvedValue({
    data: readError ? null : { ai_data_sharing_consent: consent },
    error: readError,
  });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: jest.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })),
  };
}

function useConsent(consent: boolean | null, readError: unknown = null) {
  const client = stubSupabase(consent, readError);
  (createClient as jest.Mock).mockResolvedValue(client);
  (createUntypedServerClient as jest.Mock).mockResolvedValue(client);
}

describe('hasAiDataSharingConsent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is true only for an explicit TRUE', async () => {
    useConsent(true);
    await expect(hasAiDataSharingConsent('user-1')).resolves.toBe(true);
  });

  it.each([
    ['never asked (NULL)', null],
    ['declined', false],
  ])('is false when %s', async (_label, consent) => {
    useConsent(consent);
    await expect(hasAiDataSharingConsent('user-1')).resolves.toBe(false);
  });

  it('is false when the row cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    useConsent(true, { message: 'boom' });
    await expect(hasAiDataSharingConsent('user-1')).resolves.toBe(false);
  });
});

describe('AI actions without consent', () => {
  const env = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, ANTHROPIC_API_KEY: 'test-key', XAI_API_KEY: 'test-key' };
    useConsent(false);
  });

  afterAll(() => {
    process.env = env;
  });

  it('meal parsing refuses before calling Anthropic', async () => {
    await expect(parseMealDescription('two eggs and toast')).resolves.toEqual({
      ok: false,
      error: AI_CONSENT_REQUIRED_MESSAGE,
    });
    expect(mockAnthropic).not.toHaveBeenCalled();
  });

  it('plan review refuses before calling xAI', async () => {
    const payload = { plan: [{ exercise: 'Bench Press' }] } as unknown as ReviewPayload;
    await expect(reviewWorkoutPlan(payload)).resolves.toEqual({
      ok: false,
      error: AI_CONSENT_REQUIRED_MESSAGE,
    });
    expect(mockOpenAI).not.toHaveBeenCalled();
  });
});

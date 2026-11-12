/**
 * sendCoachingMessage must enforce, server-side, the tier gate the AI Coach
 * page applies in the UI, plus a message-length cap, a history cap and the
 * daily quota — before any provider client is built.
 */
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockConversation = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = async () => mockConversation();
      builder.update = () => ({ eq: async () => ({ error: null }) });
      builder.insert = () => builder;
      return builder;
    },
  })),
  createUntypedServerClient: jest.fn(),
}));
jest.mock('@/lib/ai/consent', () => ({
  AI_CONSENT_REQUIRED_MESSAGE: 'consent required',
  hasAiDataSharingConsent: jest.fn(async () => true),
}));
jest.mock('@/lib/subscription/requireTier', () => ({
  TIER_REQUIRED_MESSAGES: { 'ai-coaching': 'AI Coach is part of the Elite plan. Upgrade to use it.' },
  userHasFeatureAccess: jest.fn(),
}));
jest.mock('@/lib/data/coachingContext', () => ({ buildCoachingContext: jest.fn(async () => null) }));

const mockCreate = jest.fn();
const mockOpenAI = jest.fn(() => ({ chat: { completions: { create: mockCreate } } }));
jest.mock('openai', () => ({
  __esModule: true,
  default: function OpenAI(...args: unknown[]) {
    return mockOpenAI(...(args as []));
  },
}));

import { sendCoachingMessage } from '@/lib/actions/coaching';
import { userHasFeatureAccess } from '@/lib/subscription/requireTier';

const mockAccess = userHasFeatureAccess as jest.MockedFunction<typeof userHasFeatureAccess>;

describe('sendCoachingMessage gating', () => {
  const env = process.env;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, XAI_API_KEY: 'key' };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockAccess.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'reply' } }] });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    errorSpy.mockRestore();
  });

  it('refuses a user without ai-coaching access and never calls the provider', async () => {
    mockAccess.mockResolvedValue(false);
    await expect(sendCoachingMessage('hi')).rejects.toThrow(/Elite/);
    expect(mockAccess).toHaveBeenCalledWith('user-1', 'ai-coaching');
    expect(mockOpenAI).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects empty and over-long messages without spending quota', async () => {
    await expect(sendCoachingMessage('   ')).rejects.toThrow(/Type a message/);
    await expect(sendCoachingMessage('x'.repeat(4001))).rejects.toThrow(/under 4000 characters/);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it('refuses when the daily quota is used up', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    await expect(sendCoachingMessage('hi')).rejects.toThrow(/today's limit/);
    expect(mockRpc).toHaveBeenCalledWith('consume_ai_quota', { p_feature: 'coach_chat', p_daily_limit: 100 });
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it('sends only the most recent history to the model', async () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      timestamp: 't',
    }));
    mockConversation.mockResolvedValue({ data: { id: 'c1', messages: history }, error: null });

    await sendCoachingMessage('latest', 'c1');

    const sent = mockCreate.mock.calls[0][0].messages;
    // system prompt + the 20 most recent turns (the new message is the last).
    expect(sent).toHaveLength(21);
    expect(sent[0].role).toBe('system');
    expect(sent[sent.length - 1].content).toContain('latest');
    expect(sent[1].content).toBe('m41');
  });
});

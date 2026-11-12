/**
 * @jest-environment node
 */
const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { updateSession } from '@/lib/supabase/middleware';

describe('updateSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('lets the cookieless Stripe webhook POST through without an auth check', async () => {
    const request = new NextRequest('https://example.test/api/stripe/webhook', { method: 'POST' });
    const response = await updateSession(request);
    // Not a redirect to /login: the handler verifies the Stripe signature itself.
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('still redirects other unauthenticated API calls to /login', async () => {
    for (const path of ['/api/stripe/checkout', '/api/stripe/portal', '/api/stripe/webhookish']) {
      const request = new NextRequest(`https://example.test${path}`, { method: 'POST' });
      const response = await updateSession(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://example.test/login');
    }
  });
});

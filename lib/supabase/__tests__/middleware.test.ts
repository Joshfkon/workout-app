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

  describe('Claude connector (MCP)', () => {
    const jwt = (payload: object) =>
      `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
    const sessionCookie = (payload: object) =>
      'sb-abcdef-auth-token=base64-' +
      Buffer.from(
        JSON.stringify({ access_token: jwt(payload), expires_at: Math.floor(Date.now() / 1000) + 3600 })
      ).toString('base64');

    it('serves /mcp, its metadata and the consent page without a session', async () => {
      for (const path of ['/mcp', '/.well-known/oauth-protected-resource/mcp', '/oauth/consent']) {
        const response = await updateSession(new NextRequest(`https://example.test${path}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
      }
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it('refuses a connector token used as an app session, on protected and public routes', async () => {
      const cookie = sessionCookie({ sub: 'u1', role: 'authenticated', client_id: 'claude-client' });
      for (const path of ['/dashboard', '/api/stripe/checkout', '/pricing', '/dashboard/settings']) {
        const request = new NextRequest(`https://example.test${path}`, {
          method: 'POST',
          headers: { cookie },
        });
        const response = await updateSession(request);
        expect(response.status).toBe(403);
      }
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it('does not affect an ordinary first-party session cookie', async () => {
      const cookie = sessionCookie({ sub: 'u1', role: 'authenticated' });
      const request = new NextRequest('https://example.test/dashboard', { headers: { cookie } });
      const response = await updateSession(request);
      expect(response.status).toBe(200);
    });
  });
});

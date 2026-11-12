'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { POST_LOGIN_PATH_KEY } from '@/lib/mcp/postLoginPath';

/**
 * Where Supabase Auth sends the user when an app such as Claude asks to
 * connect to their HyperTrack account (OAuth 2.1; this path is set as the
 * "authorization path" in the Supabase project's OAuth server settings).
 *
 * The route is public so a signed-out visitor is not bounced to /login and
 * stranded there: the page itself asks them to sign in and remembers where to
 * come back to.
 */
export default function ConsentPage() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}

interface PendingClient {
  name: string;
  redirect: string;
}

function Consent() {
  const id = useSearchParams().get('authorization_id');
  const [client, setClient] = useState<PendingClient | null>(null);
  const [email, setEmail] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('This link is missing its request. Start connecting again from Claude.');
      return;
    }
    let cancelled = false;
    const supabase = createUntypedClient();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!auth.user) {
        setNeedsSignIn(true);
        return;
      }
      setEmail(auth.user.email ?? '');
      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(id);
      if (cancelled) return;
      if (detailsError || !data) {
        setError('This request has expired. Start connecting again from Claude.');
        return;
      }
      // Already approved earlier: Supabase hands back the redirect directly.
      if (!('authorization_id' in data)) {
        window.location.href = data.redirect_url;
        return;
      }
      setClient({ name: data.client?.name || 'An app', redirect: data.redirect_uri });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const signIn = () => {
    try {
      sessionStorage.setItem(POST_LOGIN_PATH_KEY, `${window.location.pathname}${window.location.search}`);
    } catch {
      // Storage unavailable: the user can restart the connection from Claude.
    }
    window.location.href = '/login';
  };

  const decide = async (approve: boolean) => {
    if (!id) return;
    setBusy(true);
    const supabase = createUntypedClient();
    const { data, error: decisionError } = approve
      ? await supabase.auth.oauth.approveAuthorization(id)
      : await supabase.auth.oauth.denyAuthorization(id);
    if (decisionError || !data) {
      setBusy(false);
      setError("That didn't go through. Start connecting again from Claude.");
      return;
    }
    window.location.href = data.redirect_url;
  };

  let host = '';
  try {
    host = client ? new URL(client.redirect).host : '';
  } catch {
    host = '';
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 bg-surface-950">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold text-surface-100">Connect to HyperTrack</h1>
        {error ? (
          <p className="text-sm text-danger-400" role="alert">
            {error}
          </p>
        ) : needsSignIn ? (
          <>
            <p className="text-sm text-surface-300">
              Sign in to HyperTrack first, then you&apos;ll come back here to approve the connection.
            </p>
            <Button onClick={signIn} variant="primary" className="w-full">
              Sign in
            </Button>
          </>
        ) : !client ? (
          <p className="text-sm text-surface-400">Loading…</p>
        ) : (
          <>
            <p className="text-surface-200">
              <strong>{client.name}</strong> wants to read your HyperTrack data
              {email ? (
                <>
                  {' '}
                  (<strong>{email}</strong>)
                </>
              ) : null}
              .
            </p>
            <ul className="text-sm text-surface-400 list-disc pl-5 space-y-1">
              <li>See your workouts, sets, program and training volume.</li>
              <li>See your nutrition log, body weight, body composition, steps and sleep.</li>
              <li>It cannot change or delete anything.</li>
            </ul>
            {host && (
              <p className="text-xs text-surface-500">
                You&apos;ll be sent back to {host}. You can disconnect it at any time from that app&apos;s
                connector settings.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={() => decide(true)} disabled={busy} variant="primary" className="flex-1">
                {busy ? 'Connecting…' : 'Allow'}
              </Button>
              <Button onClick={() => decide(false)} disabled={busy} variant="secondary" className="flex-1">
                Deny
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}

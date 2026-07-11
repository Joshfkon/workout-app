import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

// Singleton instances to avoid creating new clients on every call
// This reduces memory overhead and ensures connection reuse
let typedClientInstance: ReturnType<typeof createBrowserClient<Database>> | null = null;
let untypedClientInstance: ReturnType<typeof createBrowserClient> | null = null;

/**
 * SSR prerender safety.
 *
 * `createBrowserClient` THROWS when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are
 * missing (see @supabase/ssr). Several `'use client'` pages construct the
 * client in their component body (e.g. `const supabase = createClient()`),
 * which also runs during Next's static prerender on the server. If the build
 * env doesn't inline those NEXT_PUBLIC_* vars, that render-time call throws and
 * fails the build with "Error occurred prerendering page" — this is exactly
 * what took out /dashboard/log, /templates, /train and /workout/quick.
 *
 * The Supabase browser client is only ever *used* from effects and event
 * handlers (never during render), so on the server we hand back a harmless
 * throwaway client built with placeholder credentials. It's never exercised
 * during prerender (no effects run), and in the browser — where NEXT_PUBLIC_*
 * are always inlined — we build and cache the real singleton as before.
 */
const isServer = typeof window === 'undefined';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Non-empty placeholders so construction can't throw during prerender. Any
// request made with these would fail, but none is ever made server-side.
const PRERENDER_URL = 'http://localhost:54321';
const PRERENDER_KEY = 'prerender-placeholder-key';

/**
 * Create a fully typed Supabase client for browser use.
 * Uses a singleton pattern to reuse the same client instance.
 * Use this for read operations where type safety is desired.
 */
export function createClient() {
  if (isServer) {
    // Throwaway, never used during prerender — keeps the build from crashing
    // when NEXT_PUBLIC_* vars aren't available at build time.
    return createBrowserClient<Database>(
      SUPABASE_URL ?? PRERENDER_URL,
      SUPABASE_ANON_KEY ?? PRERENDER_KEY
    );
  }
  if (!typedClientInstance) {
    typedClientInstance = createBrowserClient<Database>(
      SUPABASE_URL!,
      SUPABASE_ANON_KEY!
    );
  }
  return typedClientInstance;
}

/**
 * Create an untyped Supabase client for write operations.
 * Uses a singleton pattern to reuse the same client instance.
 *
 * WHY THIS EXISTS:
 * The Database types generated from Supabase schema don't always match
 * the runtime data shapes (e.g., optional fields, computed columns, JSON fields).
 * This causes TypeScript errors on insert/update operations.
 *
 * WHEN TO USE:
 * - Insert/update/upsert operations where type mismatches occur
 * - Complex queries with joins that TypeScript can't infer
 *
 * WHEN NOT TO USE:
 * - Simple read operations (use createClient() instead)
 * - New code where you can properly type the data
 *
 * TODO: Gradually migrate to typed operations by fixing Database types
 * to match actual schema, including:
 * - Making optional columns nullable in types
 * - Adding proper JSON field types
 * - Handling computed/generated columns
 */
export function createUntypedClient() {
  if (isServer) {
    // Throwaway server client (see createClient above) — never used during
    // prerender, but constructs without real env vars so the build can't crash.
    return createBrowserClient(
      SUPABASE_URL ?? PRERENDER_URL,
      SUPABASE_ANON_KEY ?? PRERENDER_KEY
    ) as any;
  }
  if (!untypedClientInstance) {
    untypedClientInstance = createBrowserClient(
      SUPABASE_URL!,
      SUPABASE_ANON_KEY!
    );
  }
  return untypedClientInstance as any;
}


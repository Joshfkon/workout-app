import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Create a fully typed Supabase client for browser use.
 * Use this for read operations where type safety is desired.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Create an untyped Supabase client for write operations.
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
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}


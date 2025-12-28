import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

// Singleton instances to avoid creating new clients on every call
// This reduces memory overhead and ensures connection reuse
let typedClientInstance: ReturnType<typeof createBrowserClient<Database>> | null = null;
let untypedClientInstance: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Create a fully typed Supabase client for browser use.
 * Uses a singleton pattern to reuse the same client instance.
 * Use this for read operations where type safety is desired.
 */
export function createClient() {
  if (!typedClientInstance) {
    typedClientInstance = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
  if (!untypedClientInstance) {
    untypedClientInstance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return untypedClientInstance as any;
}


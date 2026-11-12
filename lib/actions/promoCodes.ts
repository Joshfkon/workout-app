'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

interface RedeemResult {
  success: boolean;
  message: string;
  tier?: 'pro' | 'elite';
  isLifetime?: boolean;
}

/** Longest code accepted (real codes are far shorter). */
const MAX_CODE_LENGTH = 64;

/** Shape returned by the redeem_promo_code RPC. */
interface RedeemRpcResult {
  ok?: boolean;
  error?: string;
  tier?: string;
  is_lifetime?: boolean;
  duration_type?: string;
  duration_value?: number | null;
}

const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Invalid promo code. Please check and try again.',
  expired: 'This promo code has expired.',
  max_uses: 'This promo code has reached its maximum uses.',
  already_redeemed: 'You have already redeemed this code.',
  already_lifetime: 'You already have a lifetime Elite subscription!',
};

/**
 * Redeem a promo code for the current user
 */
export async function redeemPromoCode(code: string): Promise<RedeemResult> {
  // Get current user
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, message: 'You must be logged in to redeem a code' };
  }

  // Use service role for database operations
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return { success: false, message: 'Server configuration error. Please contact support.' };
  }
  
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  // Normalize the code (uppercase, trim)
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalizedCode || normalizedCode.length > MAX_CODE_LENGTH) {
    return { success: false, message: 'Invalid promo code. Please check and try again.' };
  }

  // One transactional RPC (migration 20261112000002): it locks the code row,
  // re-checks expiry / max uses / prior redemption, then increments the use
  // count, records the redemption and activates the subscription together.
  // Concurrent redemptions of a single-use code can no longer all pass, and a
  // failed subscription write no longer burns the code.
  const { data, error } = await serviceSupabase.rpc('redeem_promo_code', {
    p_user_id: user.id,
    p_code: normalizedCode,
  });

  if (error) {
    console.error('Promo code redemption error:', error);
    // Function or table missing: the migration has not been applied.
    if (
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.code === '42P01' ||
      error.message?.includes('relation')
    ) {
      return { success: false, message: 'Promo code system is not yet configured. Please contact support.' };
    }
    return { success: false, message: 'Failed to redeem code. Please try again or contact support.' };
  }

  const result = (data ?? {}) as RedeemRpcResult;
  if (!result.ok) {
    return {
      success: false,
      message: REDEEM_ERROR_MESSAGES[result.error ?? ''] ?? 'Failed to redeem code. Please try again.',
    };
  }

  const promoCode = {
    tier: result.tier === 'pro' ? ('pro' as const) : ('elite' as const),
    duration_type: result.duration_type,
    duration_value: result.duration_value,
  };
  const isLifetime = result.is_lifetime === true;

  const tierLabel = promoCode.tier === 'elite' ? 'Elite' : 'Pro';
  const durationLabel = isLifetime ? 'lifetime' : `${promoCode.duration_value} ${promoCode.duration_type}`;

  return {
    success: true,
    message: `🎉 Success! You now have ${tierLabel} access for ${durationLabel}!`,
    tier: promoCode.tier,
    isLifetime,
  };
}

/**
 * Check if user has redeemed any promo codes
 */
export async function getUserPromoRedemptions() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return [];
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return [];
  }
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  const { data: redemptions } = await serviceSupabase
    .from('promo_code_redemptions')
    .select(`
      id,
      redeemed_at,
      promo_codes (
        code,
        tier,
        duration_type,
        description
      )
    `)
    .eq('user_id', user.id);

  return redemptions || [];
}


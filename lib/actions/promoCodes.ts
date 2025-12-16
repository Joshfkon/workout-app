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
  const normalizedCode = code.trim().toUpperCase();
  console.log('Looking up promo code:', normalizedCode);

  // Find the promo code
  const { data: promoCode, error: codeError } = await serviceSupabase
    .from('promo_codes')
    .select('*')
    .eq('code', normalizedCode)
    .eq('is_active', true)
    .single();

  if (codeError) {
    console.error('Promo code lookup error:', codeError);
    // Check if it's a "relation does not exist" error (table not created)
    if (codeError.message?.includes('relation') || codeError.code === '42P01') {
      return { success: false, message: 'Promo code system is not yet configured. Please contact support.' };
    }
    // PGRST116 means no rows returned (code not found)
    if (codeError.code === 'PGRST116') {
      return { success: false, message: 'Invalid promo code. Please check and try again.' };
    }
    return { success: false, message: `Code lookup failed: ${codeError.message}` };
  }
  
  if (!promoCode) {
    return { success: false, message: 'Invalid promo code. Please check and try again.' };
  }
  
  console.log('Found promo code:', promoCode.id, promoCode.code);

  // Check if code has expired
  if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date()) {
    return { success: false, message: 'This promo code has expired.' };
  }

  // Check if max uses reached
  if (promoCode.max_uses && promoCode.current_uses >= promoCode.max_uses) {
    return { success: false, message: 'This promo code has reached its maximum uses.' };
  }

  // Check if user already redeemed this code
  const { data: existingRedemption } = await serviceSupabase
    .from('promo_code_redemptions')
    .select('id')
    .eq('promo_code_id', promoCode.id)
    .eq('user_id', user.id)
    .single();

  if (existingRedemption) {
    return { success: false, message: 'You have already redeemed this code.' };
  }

  // Check if user already has an active subscription
  const { data: existingSub } = await serviceSupabase
    .from('subscriptions')
    .select('tier, is_lifetime')
    .eq('user_id', user.id)
    .single();

  if (existingSub?.is_lifetime && existingSub?.tier === 'elite') {
    return { success: false, message: 'You already have a lifetime Elite subscription!' };
  }

  // Calculate expiration date if not lifetime
  let currentPeriodEnd: string | null = null;
  const isLifetime = promoCode.duration_type === 'lifetime';
  
  if (!isLifetime && promoCode.duration_value) {
    const endDate = new Date();
    if (promoCode.duration_type === 'months') {
      endDate.setMonth(endDate.getMonth() + promoCode.duration_value);
    } else if (promoCode.duration_type === 'years') {
      endDate.setFullYear(endDate.getFullYear() + promoCode.duration_value);
    }
    currentPeriodEnd = endDate.toISOString();
  } else if (isLifetime) {
    // Set a far future date for lifetime
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 100);
    currentPeriodEnd = farFuture.toISOString();
  }

  // Create redemption record
  const { error: redemptionError } = await serviceSupabase
    .from('promo_code_redemptions')
    .insert({
      promo_code_id: promoCode.id,
      user_id: user.id,
    });

  if (redemptionError) {
    console.error('Error creating redemption:', redemptionError);
    if (redemptionError.message?.includes('relation') || redemptionError.code === '42P01') {
      return { success: false, message: 'Promo code system is not yet configured. Please contact support.' };
    }
    return { success: false, message: `Failed to redeem code: ${redemptionError.message}` };
  }

  // Increment usage count
  await serviceSupabase
    .from('promo_codes')
    .update({ current_uses: promoCode.current_uses + 1 })
    .eq('id', promoCode.id);

  // Update subscription
  const { error: subError } = await serviceSupabase
    .from('subscriptions')
    .upsert({
      user_id: user.id,
      tier: promoCode.tier,
      status: 'active',
      promo_code_id: promoCode.id,
      is_lifetime: isLifetime,
      current_period_end: currentPeriodEnd,
      current_period_start: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  if (subError) {
    console.error('Error updating subscription:', subError);
    return { success: false, message: `Failed to activate subscription: ${subError.message}` };
  }

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

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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


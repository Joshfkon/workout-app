import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_PRICES, getTierFromPriceId } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

/**
 * Resolve what the client asked for to a paid tier. The app sends the tier
 * NAME ('pro' | 'elite') in `priceId`; a configured Stripe price id is also
 * accepted. Anything else is rejected — it used to fall through to Elite.
 */
function resolveRequestedTier(priceId: unknown): 'pro' | 'elite' | null {
  if (priceId === 'pro' || priceId === 'elite') return priceId;
  if (typeof priceId !== 'string' || !priceId) return null;
  const tier = getTierFromPriceId(priceId);
  return tier === 'free' ? null : tier;
}

/** Statuses where Stripe still considers the subscription live. */
const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

export async function POST(request: NextRequest) {
  try {
    const { priceId, billingPeriod } = await request.json();
    
    // Validate input
    const requestedTier = resolveRequestedTier(priceId);
    if (!requestedTier || !['monthly', 'yearly'].includes(billingPeriod)) {
      return NextResponse.json(
        { error: 'Invalid price or billing period' },
        { status: 400 }
      );
    }

    // The price always comes from server config, never from the request.
    const actualPriceId = STRIPE_PRICES[requestedTier][billingPeriod as 'monthly' | 'yearly'];
    if (!actualPriceId) {
      console.error(`Stripe price id for ${requestedTier}/${billingPeriod} is not configured`);
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // Get user from auth header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get or create Stripe customer
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );
    
    const { data: subscription } = await serviceSupabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();
    
    let customerId = subscription?.stripe_customer_id;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      console.error('NEXT_PUBLIC_APP_URL is not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Already has a live Stripe subscription: a second checkout would create
    // a second subscription billing in parallel. Send them to the billing
    // portal instead, where the existing plan can be changed or cancelled.
    if (
      customerId &&
      subscription?.stripe_subscription_id &&
      LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)
    ) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appUrl}/dashboard/settings`,
      });
      return NextResponse.json({ url: portal.url, portal: true });
    }
    
    if (!customerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;
      
      // Store customer ID. An existing row (e.g. a promo-code subscription
      // with no Stripe customer yet) keeps its tier and status.
      const { error: storeError } = subscription
        ? await serviceSupabase
            .from('subscriptions')
            .update({ stripe_customer_id: customerId })
            .eq('user_id', user.id)
        : await serviceSupabase
            .from('subscriptions')
            .upsert({
              user_id: user.id,
              stripe_customer_id: customerId,
              tier: 'free',
              status: 'incomplete',
            }, {
              onConflict: 'user_id',
            });
      if (storeError) {
        // Without the stored id the webhook cannot match this customer to a
        // user reliably, and the next checkout would create another customer.
        console.error('Failed to store Stripe customer id:', storeError);
        return NextResponse.json(
          { error: 'Failed to create checkout session' },
          { status: 500 }
        );
      }
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: actualPriceId,
          quantity: 1,
        },
      ],
      // The pricing page is the one that reads ?checkout= and shows the
      // confirmation; settings never did, so the success message was lost.
      success_url: `${appUrl}/dashboard/pricing?checkout=success`,
      cancel_url: `${appUrl}/dashboard/pricing?checkout=canceled`,
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
        },
      },
      allow_promotion_codes: true,
    });
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { stripe, getTierFromPriceId } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Disable body parsing, we need raw body for webhook signature verification
export const runtime = 'nodejs';

async function getSupabaseAdmin() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured - required for webhook processing');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );
}

/**
 * Re-fetch the subscription from Stripe so we always write the current state,
 * regardless of the order webhook events were delivered in. Stripe does not
 * guarantee ordered delivery, so an older `customer.subscription.updated` event
 * could otherwise clobber newer state. Retrieving the live object before
 * writing makes Stripe the source of truth and neutralizes out-of-order events.
 */
async function fetchAuthoritativeSubscription(
  subscription: Stripe.Subscription
): Promise<Stripe.Subscription> {
  try {
    return await stripe.subscriptions.retrieve(subscription.id);
  } catch (err) {
    // If the re-fetch fails (e.g. subscription already deleted), fall back to
    // the event payload rather than dropping the update entirely.
    console.error('Failed to re-fetch subscription, using event payload:', err);
    return subscription;
  }
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const supabase = await getSupabaseAdmin();

  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierFromPriceId(priceId);
  
  // Find user by customer ID
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();
  
  if (!existingSub) {
    // Try to find by metadata
    const userId = subscription.metadata.supabase_user_id;
    if (!userId) {
      console.error('No user found for customer:', customerId);
      return;
    }
    
    // Get period dates from the subscription (handle different Stripe API versions)
    const subAny = subscription as unknown as Record<string, unknown>;
    const periodStart = subAny.current_period_start as number | undefined;
    const periodEnd = subAny.current_period_end as number | undefined;
    
    // Create subscription record
    await supabase
      .from('subscriptions')
      .upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        tier,
        status: subscription.status,
        trial_ends_at: subscription.trial_end 
          ? new Date(subscription.trial_end * 1000).toISOString() 
          : null,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      }, {
        onConflict: 'user_id',
      });
  } else {
    // Get period dates from the subscription (handle different Stripe API versions)
    const subAny = subscription as unknown as Record<string, unknown>;
    const periodStart = subAny.current_period_start as number | undefined;
    const periodEnd = subAny.current_period_end as number | undefined;
    
    // Update existing subscription
    await supabase
      .from('subscriptions')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        tier,
        status: subscription.status,
        trial_ends_at: subscription.trial_end 
          ? new Date(subscription.trial_end * 1000).toISOString() 
          : null,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      })
      .eq('stripe_customer_id', customerId);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const supabase = await getSupabaseAdmin();
  const customerId = subscription.customer as string;
  
  // Update to canceled status but keep the record
  await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      tier: 'free',
    })
    .eq('stripe_customer_id', customerId);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const supabase = await getSupabaseAdmin();
  const customerId = invoice.customer as string;
  
  // Update status to past_due
  await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
    })
    .eq('stripe_customer_id', customerId);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');
    
    if (!signature) {
      return NextResponse.json(
        { error: 'No signature' },
        { status: 400 }
      );
    }
    
    let event: Stripe.Event;
    
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }
    
    // Idempotency guard: Stripe delivers events at-least-once, so the same
    // event.id can arrive multiple times. Atomically claim the event by
    // inserting its id; if it already exists, we've processed it before and
    // can safely skip. This uses the insert-then-process pattern so a duplicate
    // can never re-run side effects.
    const supabaseAdmin = await getSupabaseAdmin();
    const { error: claimError } = await supabaseAdmin
      .from('stripe_processed_events')
      .insert({ id: event.id, type: event.type });

    if (claimError) {
      // Unique-violation (23505) means this event was already processed.
      if (claimError.code === '23505') {
        console.log(`Skipping already-processed Stripe event: ${event.id}`);
        return NextResponse.json({ received: true, duplicate: true });
      }
      // Any other error means we couldn't record the claim. Fail loudly so
      // Stripe retries rather than risk silently double-processing.
      console.error('Failed to record Stripe event for idempotency:', claimError);
      return NextResponse.json(
        { error: 'Failed to record event' },
        { status: 500 }
      );
    }

    try {
      // Handle the event
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          // Re-fetch as source of truth to defend against out-of-order delivery.
          const authoritative = await fetchAuthoritativeSubscription(
            event.data.object as Stripe.Subscription
          );
          await handleSubscriptionChange(authoritative);
          break;
        }

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_succeeded': {
          // Payment successful - subscription update will handle status
          const invoice = event.data.object as unknown as Record<string, unknown>;
          const invoiceSubscription = invoice.subscription as string | null;
          if (invoiceSubscription) {
            const subscription = await stripe.subscriptions.retrieve(invoiceSubscription);
            await handleSubscriptionChange(subscription);
          }
          break;
        }

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (handlerError) {
      // Processing failed after we claimed the event. Remove the claim so
      // Stripe's retry can re-attempt instead of being deduped away.
      console.error('Webhook handler failed, releasing idempotency claim:', handlerError);
      await supabaseAdmin
        .from('stripe_processed_events')
        .delete()
        .eq('id', event.id);
      return NextResponse.json(
        { error: 'Webhook handler failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}


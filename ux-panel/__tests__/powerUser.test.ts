/**
 * Power-user coverage: the opt-in plan-training journey runs only for the
 * personas that ask for it, Pro-seeded personas get an active Pro row, and
 * their week review frames the pay question as "would you keep paying".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JOURNEYS, journeyById, personaRunsJourney } from '../journeys.mjs';
import { proSubscriptionRow } from '../lib/accounts.mjs';
import { pricingContext } from '../lib/agent.mjs';
import { getEffectiveTier, isTrialActive } from '@/lib/subscription';

const { personas } = JSON.parse(readFileSync(path.join(__dirname, '..', 'personas.json'), 'utf8')) as { personas: Array<Record<string, any>> };
const planTraining = journeyById('plan-training');

describe('plan-training journey', () => {
  it('is opt-in and runs only for personas that list it', () => {
    expect(planTraining.optIn).toBe(true);
    const runners = personas.filter((p) => personaRunsJourney(p, planTraining)).map((p) => p.id);
    expect(runners.sort()).toEqual(['cutting-bodybuilder-dre', 'offseason-bodybuilder-vince']);
  });

  it('only goes to advanced lifters', () => {
    for (const p of personas.filter((x) => (x.journeys ?? []).includes('plan-training'))) expect(p.experience).toBe('advanced');
  });

  it('leaves every other journey as it was (skip lists still apply)', () => {
    const priya = personas.find((p) => p.id === 'food-only-priya')!;
    expect(personaRunsJourney(priya, journeyById('log-workout'))).toBe(false);
    expect(personaRunsJourney(priya, journeyById('log-meal'))).toBe(true);
    for (const p of personas) for (const j of JOURNEYS.filter((x) => !x.optIn)) expect(personaRunsJourney(p, j)).toBe(!(p.skip ?? []).includes(j.id));
  });
});

describe('Pro seeding', () => {
  it('marks the personas who would pay', () => {
    expect(personas.filter((p) => p.account?.tier === 'pro').map((p) => p.id).sort()).toEqual(['cutting-bodybuilder-dre', 'offseason-bodybuilder-vince']);
  });

  it('seeds a row the app reads as Pro, not as the Elite in-app trial', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const row = proSubscriptionRow('u1', now);
    expect(row).toMatchObject({ user_id: 'u1', tier: 'pro', status: 'active' });
    expect(Object.keys(row).some((k) => k.startsWith('stripe'))).toBe(false);
    // useSubscription: isTrialing = inTrial && status !== 'active'. A seeded
    // account is inside its 14-day trial window, and must still read as Pro.
    const inTrial = isTrialActive(new Date());
    expect(inTrial).toBe(true);
    expect(getEffectiveTier(row.tier as 'pro', row.status as 'active', inTrial && row.status !== 'active')).toBe('pro');
  });
});

describe('week review pricing context', () => {
  it('tells a Pro-seeded persona they were on a Pro trial', () => {
    const text = pricingContext({ account: { tier: 'pro' } });
    expect(text).toMatch(/Pro trial this week/);
    expect(text).toMatch(/keep paying \$4\.99\/month/);
  });

  it('is unchanged for everyone else', () => {
    expect(pricingContext({ account: {} })).toBe(
      "HyperTrack's pricing: Free covers unlimited workout logging, exercise history, basic progress tracking. Pro ($4.99/month) adds ai mesocycle builder, smart weight suggestions, advanced analytics, unlimited workouts, priority support. Some of what you used this week may have been Pro features.",
    );
  });
});

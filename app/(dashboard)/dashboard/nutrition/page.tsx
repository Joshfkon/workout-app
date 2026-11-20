'use client';

import { NutritionScreen } from './_components/NutritionScreen';

/** Eat: today's food log. Weight & trends is its own route (./trends). */
export default function NutritionPage() {
  return <NutritionScreen view="log" />;
}

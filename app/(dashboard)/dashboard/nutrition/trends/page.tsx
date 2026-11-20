'use client';

import { NutritionScreen } from '../_components/NutritionScreen';

/**
 * Weight & trends: weigh-ins, energy burn and nutrition trends, pushed from
 * the Eat page's "Weight & trends" row. Replaces the old ?tab=weight and
 * ?tab=insights views (those links redirect here).
 */
export default function NutritionTrendsPage() {
  return <NutritionScreen view="trends" />;
}

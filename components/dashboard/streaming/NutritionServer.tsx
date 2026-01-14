import { fetchNutritionData } from '@/lib/actions/dashboard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import Link from 'next/link';

interface Props {
  userId: string;
}

export async function NutritionServer({ userId }: Props) {
  const { totals, targets } = await fetchNutritionData(userId);

  const macros = [
    { name: 'Calories', current: totals.calories, target: targets?.calories || 2000, unit: '', color: 'primary' },
    { name: 'Protein', current: totals.protein, target: targets?.protein || 150, unit: 'g', color: 'success' },
    { name: 'Carbs', current: totals.carbs, target: targets?.carbs || 200, unit: 'g', color: 'warning' },
    { name: 'Fat', current: totals.fat, target: targets?.fat || 65, unit: 'g', color: 'accent' },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Nutrition
          </CardTitle>
          <Link
            href="/dashboard/nutrition"
            className="text-sm text-primary-400 hover:text-primary-300"
          >
            Details
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {macros.map((macro) => {
            const percentage = macro.target > 0 ? Math.min((macro.current / macro.target) * 100, 100) : 0;
            const colorClass = {
              primary: 'bg-primary-500',
              success: 'bg-success-500',
              warning: 'bg-warning-500',
              accent: 'bg-accent-500',
            }[macro.color];

            return (
              <div key={macro.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-surface-400">{macro.name}</span>
                  <span className="text-surface-200">
                    {Math.round(macro.current)}{macro.unit} / {macro.target}{macro.unit}
                  </span>
                </div>
                <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colorClass} rounded-full transition-all duration-300`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {!targets && (
          <div className="mt-4 pt-4 border-t border-surface-800">
            <Link
              href="/dashboard/nutrition"
              className="text-sm text-primary-400 hover:text-primary-300"
            >
              Set up nutrition targets →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

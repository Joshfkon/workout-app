/**
 * foodEmoji rule-order + fixture tests.
 *
 * TOP_30 mirrors the user's actual most-logged foods (USDA ALL-CAPS names,
 * branded products, plain custom entries). The snapshot pins the full
 * name→emoji mapping so a rule reorder that silently reassigns a staple food
 * shows up as a diff, not a surprise in the UI.
 */

import { foodEmoji, DEFAULT_FOOD_EMOJI } from '@/lib/nutrition/foodEmoji';

const TOP_30: Array<{ name: string; brand?: string }> = [
  { name: 'Chicken Breast, Grilled' },
  { name: 'Jasmine White Rice, Cooked' },
  { name: 'GREEK YOGURT, PLAIN, NONFAT', brand: 'Fage' },
  { name: 'Whey Protein Powder', brand: 'Optimum Nutrition' },
  { name: 'Protein Bar, Chocolate Chip Cookie Dough', brand: 'Quest' },
  { name: 'Eggs, Whole, Scrambled' },
  { name: 'Egg Whites' },
  { name: 'Oatmeal, Old Fashioned Oats', brand: 'Quaker' },
  { name: 'Banana, Raw' },
  { name: 'Apple, Honeycrisp' },
  { name: 'Salmon, Atlantic, Baked' },
  { name: 'Ground Beef, 93/7, Cooked' },
  { name: 'Broccoli, Steamed' },
  { name: 'Sweet Potato, Baked' },
  { name: 'Peanut Butter, Creamy', brand: 'Jif' },
  { name: 'Bread, Whole Wheat', brand: 'Dave’s Killer Bread' },
  { name: 'Blueberries, Raw' },
  { name: 'Almonds, Raw' },
  { name: 'Cottage Cheese, 2%', brand: 'Good Culture' },
  { name: 'Protein Shake, Chocolate', brand: 'Premier Protein' },
  { name: 'Pizza, Pepperoni, 14" Slice' },
  { name: 'Cheeseburger' },
  { name: 'Spaghetti with Marinara Sauce' },
  { name: 'TUNA, CANNED IN WATER, DRAINED' },
  { name: 'Avocado, Raw' },
  { name: 'Strawberries, Raw' },
  { name: 'Latte, Nonfat Milk', brand: 'Starbucks' },
  { name: 'White Cheddar Rice Cakes' },
  { name: 'Ice Cream, Vanilla', brand: 'Breyers' },
  { name: 'Mixed Greens Salad with Grilled Chicken' },
];

describe('foodEmoji', () => {
  it('maps the top-30 fixture (snapshot)', () => {
    const mapping = TOP_30.map(({ name, brand }) => ({
      name,
      ...(brand ? { brand } : {}),
      emoji: foodEmoji(name, brand),
    }));
    expect(mapping).toMatchSnapshot();
  });

  it('never returns the fallback for any top-30 staple', () => {
    for (const { name, brand } of TOP_30) {
      expect(foodEmoji(name, brand)).not.toBe(DEFAULT_FOOD_EMOJI);
    }
  });

  it('first match wins: protein SHAKE is a drink, protein BAR is a bar', () => {
    expect(foodEmoji('Protein Shake')).toBe('🥤');
    expect(foodEmoji('Protein Bar', 'Quest')).toBe('🍫');
    expect(foodEmoji('Whey Protein Isolate')).toBe('🥤');
  });

  it('orders specific before generic', () => {
    expect(foodEmoji('Sweet Potato Fries')).toBe('🍟'); // fries beats potato
    expect(foodEmoji('Sweet Potato')).toBe('🥔');
    expect(foodEmoji('Blueberry Muffin')).toBe('🫐'); // blueberry beats muffin
    expect(foodEmoji('Blueberries')).toBe('🫐');
    expect(foodEmoji('Peanut Butter')).toBe('🥜'); // peanut beats butter
    expect(foodEmoji('Butter, Salted')).toBe('🧈');
    expect(foodEmoji('Chicken Caesar Salad Sandwich')).toBe('🥪'); // dish beats ingredient
  });

  it('matches on word boundaries, not substrings', () => {
    expect(foodEmoji('Goat Cheese')).toBe('🧀'); // "goat" must not match "oat"
    expect(foodEmoji('Steak, Ribeye')).toBe('🥩'); // "steak" must not match "tea"
  });

  it('matches the brand when the name alone is ambiguous', () => {
    expect(foodEmoji('Cafe Vanilla, 11oz', 'Premier Protein')).toBe('🥤');
  });

  it('is case-insensitive (USDA ALL-CAPS names)', () => {
    expect(foodEmoji('CHICKEN BREAST, RAW')).toBe('🍗');
    expect(foodEmoji('BROCCOLI, FROZEN')).toBe('🥦');
  });

  it('falls back to the plate for unknown foods and empty input', () => {
    expect(foodEmoji('Xylophone Surprise')).toBe(DEFAULT_FOOD_EMOJI);
    expect(foodEmoji('')).toBe(DEFAULT_FOOD_EMOJI);
  });
});

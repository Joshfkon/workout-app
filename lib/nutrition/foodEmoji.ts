/**
 * foodEmoji — deterministic food-name → emoji mapping for row avatars in the
 * day log, the recents/picker lists, and the add-food sheet.
 *
 * Pure ordered rule list: rules are evaluated top-to-bottom and the FIRST
 * rule with a matching keyword wins, so specificity is encoded by position
 * ("protein shake" must be listed before "bar" catches "protein bar", fries
 * before potato so "sweet potato fries" reads 🍟, blueberry before the
 * generic berry rule, peanut before butter, …). Keywords match on word
 * boundaries against `name + brand` lowercased — "oat" never matches "goat".
 *
 * No image assets, no icon font, no dependency — plain Unicode emoji only.
 */

interface FoodEmojiRule {
  emoji: string;
  keywords: string[];
}

export const DEFAULT_FOOD_EMOJI = '🍽️';

/** Ordered rules — first match wins. Position = specificity. */
const RULES: FoodEmojiRule[] = [
  // Drinks & supplements (before "bar"/"protein" generics)
  { emoji: '🥤', keywords: ['shake', 'smoothie', 'protein shake', 'protein powder'] },
  { emoji: '🍫', keywords: ['bar', 'bars'] },
  { emoji: '🥤', keywords: ['protein', 'whey', 'casein', 'bcaa', 'preworkout', 'pre-workout'] },

  // Breakfast staples
  { emoji: '🍳', keywords: ['egg', 'eggs', 'omelet', 'omelette', 'scramble', 'frittata'] },
  { emoji: '🥣', keywords: ['yogurt', 'yoghurt', 'skyr', 'kefir'] },
  { emoji: '🥣', keywords: ['oat', 'oats', 'oatmeal', 'porridge', 'muesli'] },
  { emoji: '🥣', keywords: ['cereal', 'granola'] },
  { emoji: '🥞', keywords: ['pancake', 'pancakes', 'waffle', 'waffles', 'french toast', 'crepe'] },
  { emoji: '🥯', keywords: ['bagel'] },
  { emoji: '🥐', keywords: ['croissant', 'pastry'] },

  // Composed dishes (before their ingredients)
  { emoji: '🍕', keywords: ['pizza'] },
  { emoji: '🍔', keywords: ['burger', 'cheeseburger', 'hamburger', 'sliders'] },
  { emoji: '🥪', keywords: ['sandwich', 'sub', 'blt', 'panini', 'hoagie'] },
  { emoji: '🌮', keywords: ['taco', 'tacos'] },
  { emoji: '🌯', keywords: ['burrito', 'wrap', 'quesadilla'] },
  { emoji: '🍣', keywords: ['sushi', 'sashimi', 'poke'] },
  { emoji: '🍲', keywords: ['soup', 'stew', 'chili', 'curry', 'ramen', 'pho'] },
  { emoji: '🍝', keywords: ['pasta', 'spaghetti', 'penne', 'noodle', 'noodles', 'lasagna', 'mac and cheese', 'macaroni'] },
  { emoji: '🍟', keywords: ['fries', 'french fries', 'tots'] },

  // Proteins
  { emoji: '🍤', keywords: ['shrimp', 'prawn', 'prawns'] },
  { emoji: '🐟', keywords: ['salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'mahi', 'fish', 'sardine', 'anchovy'] },
  { emoji: '🍗', keywords: ['chicken', 'turkey', 'poultry', 'wing', 'wings', 'drumstick'] },
  { emoji: '🥓', keywords: ['bacon', 'ham', 'sausage', 'pork', 'prosciutto', 'salami', 'pepperoni'] },
  { emoji: '🥩', keywords: ['steak', 'beef', 'brisket', 'meatball', 'meatballs', 'lamb', 'venison', 'bison', 'ribeye', 'sirloin'] },
  { emoji: '🌱', keywords: ['tofu', 'tempeh', 'edamame', 'seitan'] },

  // Carbs & sides
  { emoji: '🍚', keywords: ['rice', 'quinoa'] },
  { emoji: '🥔', keywords: ['potato', 'potatoes', 'hash brown', 'hash browns', 'tater'] },
  { emoji: '🍞', keywords: ['bread', 'toast', 'sourdough', 'roll', 'bun', 'tortilla', 'pita', 'naan'] },

  // Vegetables & salads
  { emoji: '🥗', keywords: ['salad', 'lettuce', 'spinach', 'kale', 'greens', 'slaw', 'arugula'] },
  { emoji: '🥕', keywords: ['carrot', 'carrots'] },
  { emoji: '🌽', keywords: ['corn'] },
  { emoji: '🥑', keywords: ['avocado', 'guacamole', 'guac'] },
  { emoji: '🥦', keywords: ['broccoli', 'asparagus', 'zucchini', 'cucumber', 'pepper', 'peppers', 'cauliflower', 'brussels', 'green bean', 'green beans', 'vegetable', 'vegetables', 'veggie', 'veggies', 'onion', 'mushroom', 'mushrooms', 'tomato', 'tomatoes'] },

  // Fruit (blueberry before the generic berry rule)
  { emoji: '🍌', keywords: ['banana', 'bananas'] },
  { emoji: '🍎', keywords: ['apple', 'apples', 'applesauce'] },
  { emoji: '🫐', keywords: ['blueberry', 'blueberries'] },
  { emoji: '🍓', keywords: ['strawberry', 'strawberries', 'raspberry', 'raspberries', 'blackberry', 'blackberries', 'berry', 'berries'] },
  { emoji: '🍊', keywords: ['orange', 'oranges', 'mandarin', 'clementine', 'tangerine'] },
  { emoji: '🍇', keywords: ['grape', 'grapes', 'raisin', 'raisins'] },
  { emoji: '🍉', keywords: ['watermelon', 'melon', 'cantaloupe', 'honeydew'] },
  { emoji: '🍍', keywords: ['pineapple'] },
  { emoji: '🍑', keywords: ['peach', 'peaches', 'mango', 'apricot', 'nectarine', 'fruit'] },

  // Nuts, dairy & fats (peanut before butter)
  { emoji: '🥜', keywords: ['peanut', 'peanuts', 'almond', 'almonds', 'cashew', 'cashews', 'pistachio', 'pistachios', 'walnut', 'walnuts', 'pecan', 'pecans', 'nut', 'nuts', 'trail mix'] },
  { emoji: '🧀', keywords: ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'gouda', 'cottage'] },

  // Treats (cookie/chocolate before milk so "chocolate milk" reads 🍫)
  { emoji: '🍪', keywords: ['cookie', 'cookies', 'biscuit'] },
  { emoji: '🍩', keywords: ['donut', 'doughnut', 'donuts'] },
  { emoji: '🍰', keywords: ['cake', 'cupcake', 'brownie', 'brownies', 'cheesecake', 'pie', 'dessert', 'muffin'] },
  { emoji: '🍦', keywords: ['ice cream', 'gelato', 'froyo', 'frozen yogurt', 'sorbet'] },
  { emoji: '🍫', keywords: ['chocolate', 'candy', 'fudge'] },
  { emoji: '🍿', keywords: ['popcorn'] },
  { emoji: '🥨', keywords: ['pretzel', 'pretzels', 'chips', 'crackers', 'crisps'] },

  // Drinks
  { emoji: '☕', keywords: ['coffee', 'latte', 'espresso', 'americano', 'cappuccino', 'mocha', 'cold brew'] },
  { emoji: '🥛', keywords: ['milk', 'cream'] },
  { emoji: '🍵', keywords: ['tea', 'matcha'] },
  { emoji: '🥤', keywords: ['soda', 'cola', 'coke', 'sprite', 'energy drink', 'gatorade', 'juice', 'lemonade'] },
  { emoji: '🍺', keywords: ['beer', 'ipa', 'lager'] },
  { emoji: '🍷', keywords: ['wine'] },

  // Fats & condiments
  { emoji: '🧈', keywords: ['butter', 'ghee', 'oil', 'mayo', 'mayonnaise'] },
  { emoji: '🍯', keywords: ['honey', 'jam', 'jelly', 'syrup', 'sugar'] },
];

/** Precompiled word-boundary matchers, one per rule, built once at load. */
const MATCHERS: { emoji: string; pattern: RegExp }[] = RULES.map((rule) => ({
  emoji: rule.emoji,
  pattern: new RegExp(
    `\\b(?:${rule.keywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})\\b`
  ),
}));

/**
 * Emoji for a food row. `brand` participates in matching (a "Premier Protein"
 * brand puts an unnamed drink in 🥤 territory) but the name is checked first
 * implicitly by simple concatenation — rules are ordered, not weighted.
 */
export function foodEmoji(name: string, brand?: string | null): string {
  const haystack = `${name ?? ''} ${brand ?? ''}`.toLowerCase();
  for (const { emoji, pattern } of MATCHERS) {
    if (pattern.test(haystack)) return emoji;
  }
  return DEFAULT_FOOD_EMOJI;
}

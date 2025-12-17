-- System foods table - pre-populated foods available to all users
-- These are common bodybuilding foods with nutrition per 100g

CREATE TABLE IF NOT EXISTS system_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'protein', 'carbs', 'fats', 'vegetables', 'fruits', 'supplements'
  subcategory VARCHAR(50), -- 'poultry', 'fish', 'dairy', 'grains', 'nuts', etc.
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC NOT NULL DEFAULT 0,
  carbs_per_100g NUMERIC NOT NULL DEFAULT 0,
  fat_per_100g NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching
CREATE INDEX idx_system_foods_name ON system_foods(name);
CREATE INDEX idx_system_foods_category ON system_foods(category);

-- Allow all authenticated users to read system foods
ALTER TABLE system_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read system foods"
  ON system_foods FOR SELECT
  TO authenticated
  USING (is_active = true);

-- =====================================================
-- PROTEINS - MEAT (Poultry)
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Chicken Breast (raw, skinless)', 'protein', 'poultry', 165, 31, 0, 3.6),
('Chicken Breast (grilled, skinless)', 'protein', 'poultry', 165, 31, 0, 3.6),
('Chicken Breast (cooked, skinless)', 'protein', 'poultry', 195, 29.6, 0, 7.8),
('Chicken Thigh (skinless, cooked)', 'protein', 'poultry', 209, 26, 0, 10.9),
('Ground Chicken (93/7 lean, cooked)', 'protein', 'poultry', 170, 24, 0, 8),
('Ground Turkey (93/7 lean, cooked)', 'protein', 'poultry', 170, 24, 0, 8),
('Ground Turkey (99/1 lean, cooked)', 'protein', 'poultry', 120, 27, 0, 1),
('Turkey Breast (deli sliced)', 'protein', 'poultry', 111, 23, 3, 1),
('Rotisserie Chicken (with skin)', 'protein', 'poultry', 237, 27, 0, 13),
('Rotisserie Chicken (skinless)', 'protein', 'poultry', 167, 29, 0, 6);

-- =====================================================
-- PROTEINS - MEAT (Beef)
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Lean Ground Beef (90/10, cooked)', 'protein', 'beef', 176, 25, 0, 8),
('Lean Ground Beef (93/7, cooked)', 'protein', 'beef', 164, 25, 0, 6),
('Extra Lean Ground Beef (96/4, cooked)', 'protein', 'beef', 155, 26, 0, 5),
('Sirloin Steak (lean, grilled)', 'protein', 'beef', 183, 27, 0, 7.5);

-- =====================================================
-- PROTEINS - MEAT (Pork & Other)
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Pork Tenderloin (lean, cooked)', 'protein', 'pork', 143, 26, 0, 3.5),
('Pork Chop (lean, grilled)', 'protein', 'pork', 206, 28, 0, 9),
('Bison (ground, cooked)', 'protein', 'game', 146, 28, 0, 2.5);

-- =====================================================
-- PROTEINS - FISH/SEAFOOD
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Salmon (Atlantic, cooked)', 'protein', 'fish', 206, 22, 0, 12),
('Salmon (wild, cooked)', 'protein', 'fish', 182, 25, 0, 8),
('Tuna (canned in water, drained)', 'protein', 'fish', 116, 26, 0, 0.8),
('Tuna Steak (cooked)', 'protein', 'fish', 144, 30, 0, 1.3),
('Cod (cooked)', 'protein', 'fish', 105, 23, 0, 0.9),
('Tilapia (cooked)', 'protein', 'fish', 129, 26, 0, 2.7),
('Halibut (cooked)', 'protein', 'fish', 140, 27, 0, 3),
('Mahi Mahi (cooked)', 'protein', 'fish', 109, 24, 0, 0.9),
('Shrimp (cooked)', 'protein', 'seafood', 99, 24, 0, 0.3),
('Crab (cooked)', 'protein', 'seafood', 97, 20, 0, 1.5);

-- =====================================================
-- PROTEINS - EGGS/DAIRY
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Whole Eggs (large, cooked)', 'protein', 'eggs', 155, 13, 1.1, 11),
('Egg Whites (liquid or cooked)', 'protein', 'eggs', 52, 11, 0.7, 0.2),
('Egg Yolk (cooked)', 'protein', 'eggs', 322, 16, 3.6, 27),
('Greek Yogurt (nonfat, plain)', 'protein', 'dairy', 59, 10, 3.6, 0.4),
('Greek Yogurt (2% fat, plain)', 'protein', 'dairy', 73, 9, 5, 2),
('Cottage Cheese (nonfat)', 'protein', 'dairy', 72, 12, 6, 0.3),
('Cottage Cheese (2% fat)', 'protein', 'dairy', 86, 11, 5, 2.3),
('Cottage Cheese (4% fat)', 'protein', 'dairy', 98, 11, 3.4, 4.3),
('Mozzarella (part skim)', 'protein', 'dairy', 254, 24, 3, 16),
('Cheddar Cheese', 'protein', 'dairy', 403, 23, 3, 33),
('Parmesan (grated)', 'protein', 'dairy', 431, 38, 4, 29),
('Milk (skim/nonfat)', 'protein', 'dairy', 34, 3.4, 5, 0.1),
('Milk (2% fat)', 'protein', 'dairy', 50, 3.3, 4.8, 2),
('Milk (whole)', 'protein', 'dairy', 61, 3.2, 4.8, 3.3);

-- =====================================================
-- CARBS - GRAINS
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('White Rice (cooked)', 'carbs', 'grains', 130, 2.7, 28, 0.3),
('Brown Rice (cooked)', 'carbs', 'grains', 111, 2.6, 23, 0.9),
('Jasmine Rice (cooked)', 'carbs', 'grains', 129, 2.7, 28, 0.2),
('Basmati Rice (cooked)', 'carbs', 'grains', 121, 2.5, 25, 0.4),
('Quinoa (cooked)', 'carbs', 'grains', 120, 4.4, 21, 1.9),
('Oatmeal (cooked/prepared)', 'carbs', 'grains', 71, 2.5, 12, 1.5),
('Oats (dry/raw)', 'carbs', 'grains', 389, 17, 66, 7),
('Cream of Rice (cooked)', 'carbs', 'grains', 56, 1, 13, 0),
('Pasta (white, cooked)', 'carbs', 'grains', 131, 5, 25, 1.1),
('Whole Wheat Pasta (cooked)', 'carbs', 'grains', 124, 5.3, 26, 1.3);

-- =====================================================
-- CARBS - BREAD
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Bread (white)', 'carbs', 'bread', 265, 9, 49, 3.2),
('Bread (whole wheat)', 'carbs', 'bread', 247, 13, 41, 3.4),
('Ezekiel Bread', 'carbs', 'bread', 250, 11, 42, 3.5),
('Bagel (plain)', 'carbs', 'bread', 257, 10, 50, 1.5),
('English Muffin', 'carbs', 'bread', 234, 9, 46, 1.5),
('Tortilla (flour, 10")', 'carbs', 'bread', 304, 8, 50, 7.5),
('Tortilla (whole wheat, 10")', 'carbs', 'bread', 210, 7, 35, 5);

-- =====================================================
-- CARBS - POTATOES/STARCHES
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Sweet Potato (baked with skin)', 'carbs', 'starches', 90, 2, 21, 0.2),
('White Potato (baked with skin)', 'carbs', 'starches', 93, 2.5, 21, 0.1),
('Red Potato (cooked)', 'carbs', 'starches', 89, 1.9, 20, 0.1),
('Yam (cooked)', 'carbs', 'starches', 116, 1.5, 28, 0.1),
('Butternut Squash (cooked)', 'carbs', 'starches', 45, 1, 12, 0.1);

-- =====================================================
-- FATS - HEALTHY SOURCES
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Almonds (raw)', 'fats', 'nuts', 579, 21, 22, 50),
('Cashews (raw)', 'fats', 'nuts', 553, 18, 30, 44),
('Walnuts (raw)', 'fats', 'nuts', 654, 15, 14, 65),
('Peanuts (dry roasted)', 'fats', 'nuts', 585, 24, 21, 50),
('Peanut Butter (natural)', 'fats', 'nut_butters', 588, 25, 20, 50),
('Almond Butter', 'fats', 'nut_butters', 614, 21, 21, 56),
('Cashew Butter', 'fats', 'nut_butters', 587, 18, 27, 49),
('Avocado', 'fats', 'fruit', 160, 2, 9, 15),
('Olive Oil', 'fats', 'oils', 884, 0, 0, 100),
('Coconut Oil', 'fats', 'oils', 862, 0, 0, 100),
('Butter', 'fats', 'dairy', 717, 0.9, 0.1, 81),
('Cream Cheese', 'fats', 'dairy', 342, 6, 5.5, 34);

-- =====================================================
-- VEGETABLES
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Broccoli', 'vegetables', 'cruciferous', 35, 2.4, 7, 0.4),
('Spinach', 'vegetables', 'leafy', 23, 3, 3.6, 0.3),
('Asparagus', 'vegetables', 'stalks', 22, 2.4, 4, 0.2),
('Green Beans', 'vegetables', 'legumes', 31, 1.8, 7, 0.1),
('Brussels Sprouts', 'vegetables', 'cruciferous', 43, 3.4, 9, 0.3),
('Cauliflower', 'vegetables', 'cruciferous', 25, 1.9, 5, 0.3),
('Zucchini', 'vegetables', 'squash', 17, 1.2, 3, 0.3),
('Bell Pepper', 'vegetables', 'peppers', 26, 1, 6, 0.2),
('Cucumber (raw)', 'vegetables', 'gourds', 12, 0.6, 2.2, 0.1),
('Tomato (raw)', 'vegetables', 'nightshades', 18, 0.9, 3.9, 0.2),
('Lettuce (romaine, raw)', 'vegetables', 'leafy', 17, 1.2, 3.3, 0.3),
('Mushrooms', 'vegetables', 'fungi', 22, 3.1, 3.3, 0.3),
('Onion', 'vegetables', 'alliums', 40, 1.1, 9, 0.1),
('Carrots', 'vegetables', 'root', 35, 0.8, 8, 0.2);

-- =====================================================
-- FRUITS
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Banana', 'fruits', 'tropical', 89, 1.1, 23, 0.3),
('Apple', 'fruits', 'pome', 52, 0.3, 14, 0.2),
('Orange', 'fruits', 'citrus', 47, 0.9, 12, 0.1),
('Blueberries', 'fruits', 'berries', 57, 0.7, 14, 0.3),
('Strawberries', 'fruits', 'berries', 32, 0.7, 8, 0.3),
('Grapes', 'fruits', 'berries', 69, 0.7, 18, 0.2),
('Watermelon', 'fruits', 'melons', 30, 0.6, 8, 0.2),
('Pineapple', 'fruits', 'tropical', 50, 0.5, 13, 0.1),
('Mango', 'fruits', 'tropical', 60, 0.8, 15, 0.4),
('Grapefruit', 'fruits', 'citrus', 42, 0.8, 11, 0.1);

-- =====================================================
-- SUPPLEMENTS/PROTEIN POWDERS
-- =====================================================

INSERT INTO system_foods (name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES
('Whey Protein Isolate (unflavored)', 'supplements', 'protein_powder', 400, 90, 0, 2),
('Whey Protein Concentrate', 'supplements', 'protein_powder', 400, 80, 6, 5),
('Casein Protein', 'supplements', 'protein_powder', 360, 80, 8, 2),
('Egg White Protein', 'supplements', 'protein_powder', 400, 85, 5, 0);

COMMENT ON TABLE system_foods IS 'Pre-populated bodybuilding foods with nutrition per 100g, available to all users';


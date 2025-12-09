-- Add weight_kg to users table for weight recommendations
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(5,2);

-- Add comment
COMMENT ON COLUMN users.weight_kg IS 'User current body weight in kg for AI weight recommendations';


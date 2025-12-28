-- Migration: Add full-text search for shared workouts
-- Enables efficient searching by title and description

-- Add text search vector column
ALTER TABLE shared_workouts ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create function to update search vector
CREATE OR REPLACE FUNCTION update_shared_workout_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update search vector
DROP TRIGGER IF EXISTS trigger_shared_workout_search_vector ON shared_workouts;
CREATE TRIGGER trigger_shared_workout_search_vector
  BEFORE INSERT OR UPDATE OF title, description ON shared_workouts
  FOR EACH ROW EXECUTE FUNCTION update_shared_workout_search_vector();

-- Update existing rows
UPDATE shared_workouts SET
  search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'B');

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_shared_workouts_search ON shared_workouts USING GIN (search_vector);

-- Function to search shared workouts with ranking
CREATE OR REPLACE FUNCTION search_shared_workouts(
  search_query TEXT,
  p_share_type TEXT DEFAULT NULL,
  p_difficulty TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  description TEXT,
  workout_data JSONB,
  share_type TEXT,
  difficulty TEXT,
  target_muscle_groups TEXT[],
  save_count INTEGER,
  copy_count INTEGER,
  view_count INTEGER,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sw.id,
    sw.user_id,
    sw.title,
    sw.description,
    sw.workout_data,
    sw.share_type,
    sw.difficulty,
    sw.target_muscle_groups,
    sw.save_count,
    sw.copy_count,
    sw.view_count,
    sw.created_at,
    ts_rank(sw.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM shared_workouts sw
  WHERE
    sw.is_public = true
    AND (search_query IS NULL OR search_query = '' OR sw.search_vector @@ websearch_to_tsquery('english', search_query))
    AND (p_share_type IS NULL OR sw.share_type = p_share_type)
    AND (p_difficulty IS NULL OR sw.difficulty = p_difficulty)
  ORDER BY
    CASE WHEN search_query IS NOT NULL AND search_query != ''
      THEN ts_rank(sw.search_vector, websearch_to_tsquery('english', search_query))
      ELSE 0
    END DESC,
    sw.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION search_shared_workouts(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

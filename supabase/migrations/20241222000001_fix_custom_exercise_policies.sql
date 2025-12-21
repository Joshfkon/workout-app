-- Fix custom exercise RLS policies
-- Remove any duplicate policies and ensure correct policy is in place

-- Drop the duplicate policy if it exists
DROP POLICY IF EXISTS "insert_custom_exercises" ON exercises;

-- Ensure the correct INSERT policy exists (recreate it to be safe)
DROP POLICY IF EXISTS "Users can create custom exercises" ON exercises;

-- Create the INSERT policy
-- Note: WITH CHECK validates the row being inserted
-- The policy allows inserts where is_custom is true and created_by matches the authenticated user
CREATE POLICY "Users can create custom exercises" ON exercises
  FOR INSERT 
  WITH CHECK (
    is_custom = TRUE 
    AND created_by = auth.uid()
  );

-- Test query to verify the policy (run this in Supabase SQL editor while logged in):
-- This should return your user ID if auth is working
-- SELECT auth.uid() as current_user_id;

-- If auth.uid() returns NULL, the RLS policy will block all inserts
-- Make sure you're authenticated in the Supabase dashboard when testing


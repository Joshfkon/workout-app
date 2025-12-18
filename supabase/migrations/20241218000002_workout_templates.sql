-- Create workout folders table
CREATE TABLE IF NOT EXISTS workout_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6', -- Default blue color
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create workout templates table
CREATE TABLE IF NOT EXISTS workout_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES workout_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  notes TEXT,
  last_performed_at TIMESTAMPTZ,
  times_performed INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create workout template exercises table
CREATE TABLE IF NOT EXISTS workout_template_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL,
  exercise_name TEXT NOT NULL, -- Denormalized for display
  exercise_type TEXT, -- 'strength', 'cardio', etc.
  sort_order INTEGER DEFAULT 0,
  default_sets INTEGER DEFAULT 3,
  default_reps TEXT DEFAULT '8-12', -- Can be a range like "8-12" or specific like "10"
  default_weight DECIMAL(10,2),
  default_rest_seconds INTEGER DEFAULT 90,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE workout_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_template_exercises ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workout_folders
CREATE POLICY "Users can view own folders" ON workout_folders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own folders" ON workout_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own folders" ON workout_folders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own folders" ON workout_folders
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for workout_templates
CREATE POLICY "Users can view own templates" ON workout_templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own templates" ON workout_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates" ON workout_templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates" ON workout_templates
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for workout_template_exercises (via template ownership)
CREATE POLICY "Users can view own template exercises" ON workout_template_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workout_templates 
      WHERE workout_templates.id = workout_template_exercises.template_id 
      AND workout_templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own template exercises" ON workout_template_exercises
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_templates 
      WHERE workout_templates.id = workout_template_exercises.template_id 
      AND workout_templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own template exercises" ON workout_template_exercises
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workout_templates 
      WHERE workout_templates.id = workout_template_exercises.template_id 
      AND workout_templates.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own template exercises" ON workout_template_exercises
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workout_templates 
      WHERE workout_templates.id = workout_template_exercises.template_id 
      AND workout_templates.user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_workout_folders_user ON workout_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_user ON workout_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_folder ON workout_templates(folder_id);
CREATE INDEX IF NOT EXISTS idx_workout_template_exercises_template ON workout_template_exercises(template_id);

-- Add comments
COMMENT ON TABLE workout_folders IS 'Folders for organizing workout templates';
COMMENT ON TABLE workout_templates IS 'User-created workout templates';
COMMENT ON TABLE workout_template_exercises IS 'Exercises within a workout template';


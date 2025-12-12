-- AI Coaching Feature: Training Phases & Conversation History

-- Training Phases Table
-- Tracks cut/bulk/maintain phases with goals and progress
CREATE TABLE IF NOT EXISTS public.training_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Phase details
  phase_type TEXT NOT NULL CHECK (phase_type IN ('cut', 'bulk', 'maintain')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Goals
  start_weight_kg DECIMAL(5,2) NOT NULL,
  target_weight_kg DECIMAL(5,2),
  target_body_fat_percent DECIMAL(4,2),

  -- Progress tracking
  current_week INTEGER NOT NULL DEFAULT 1,
  planned_duration_weeks INTEGER,

  -- Notes
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only one active phase per user
  CONSTRAINT one_active_phase_per_user UNIQUE (user_id, is_active)
);

-- AI Coaching Conversations Table
-- Stores coaching conversation history
CREATE TABLE IF NOT EXISTS public.ai_coaching_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Conversation metadata
  title TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Messages stored as JSONB array
  -- Each message: { role: 'user' | 'assistant', content: string, timestamp: ISO string, context?: CoachingContext }
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_training_phases_user_id ON public.training_phases(user_id);
CREATE INDEX idx_training_phases_active ON public.training_phases(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_ai_coaching_conversations_user_id ON public.ai_coaching_conversations(user_id);
CREATE INDEX idx_ai_coaching_conversations_last_message ON public.ai_coaching_conversations(user_id, last_message_at DESC);

-- RLS Policies
ALTER TABLE public.training_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_coaching_conversations ENABLE ROW LEVEL SECURITY;

-- Users can only view/modify their own training phases
CREATE POLICY "Users can view own training phases"
  ON public.training_phases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own training phases"
  ON public.training_phases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own training phases"
  ON public.training_phases FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own training phases"
  ON public.training_phases FOR DELETE
  USING (auth.uid() = user_id);

-- Users can only view/modify their own coaching conversations
CREATE POLICY "Users can view own coaching conversations"
  ON public.ai_coaching_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coaching conversations"
  ON public.ai_coaching_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own coaching conversations"
  ON public.ai_coaching_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own coaching conversations"
  ON public.ai_coaching_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_training_phases_updated_at
  BEFORE UPDATE ON public.training_phases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_coaching_conversations_updated_at
  BEFORE UPDATE ON public.ai_coaching_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one active phase per user
CREATE OR REPLACE FUNCTION ensure_one_active_phase()
RETURNS TRIGGER AS $$
BEGIN
  -- If setting a phase to active, deactivate all other phases for this user
  IF NEW.is_active = true THEN
    UPDATE public.training_phases
    SET is_active = false
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_active = true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_one_active_phase_trigger
  BEFORE INSERT OR UPDATE ON public.training_phases
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION ensure_one_active_phase();

-- Sign-up's experience answer reaches users.experience.
--
-- /register sends the lifting answer as auth user_metadata.experience
-- ('novice' | 'intermediate' | 'advanced'), but handle_new_user only copied
-- id and email, so every account started at the column default
-- ('intermediate'). A lifter who said "Just started" got intermediate
-- volume and Beginner mode off (UX panel round 19).
--
-- The trigger now copies the level when it is a valid enum value and falls
-- back to the column default otherwise. Accounts created before this keep
-- their row; onboarding writes the sign-up level for them while setup is
-- unfinished (lib/onboarding/experienceOptions onboardingExperience).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  signup_experience TEXT := NEW.raw_user_meta_data->>'experience';
BEGIN
  IF signup_experience IN ('novice', 'intermediate', 'advanced') THEN
    INSERT INTO public.users (id, email, experience)
    VALUES (NEW.id, NEW.email, signup_experience::public.experience);
  ELSE
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

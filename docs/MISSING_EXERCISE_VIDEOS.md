# Exercise Videos Tracker

This document tracks exercise form demonstration videos/GIFs.

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| **With Videos** | 49 | 100% |
| **Missing Videos** | 0 | 0% |
| **Total Exercises** | 49 | 100% |

All exercises now have video URLs assigned via migration `20251227000001_add_remaining_exercise_videos.sql`.

## Video Fields

The exercise system uses three optional fields for media:
- `demo_gif_url` - URL to demonstration GIF/animation
- `demo_thumbnail_url` - URL to thumbnail image
- `youtube_video_id` - YouTube video ID for form tutorials

## All Exercises (Complete)

### Chest (6)
- [x] Barbell Bench Press
- [x] Cable Fly
- [x] Dips (Chest Focus)
- [x] Dumbbell Bench Press
- [x] Incline Dumbbell Press
- [x] Machine Chest Press

### Back (7)
- [x] Barbell Row
- [x] Cable Row
- [x] Chest Supported Row
- [x] Deadlift
- [x] Dumbbell Row
- [x] Lat Pulldown
- [x] Pull-Ups

### Shoulders (5)
- [x] Dumbbell Shoulder Press
- [x] Face Pull
- [x] Lateral Raise
- [x] Overhead Press
- [x] Rear Delt Fly

### Biceps (6)
- [x] Barbell Curl
- [x] Cable Curl
- [x] Dumbbell Curl
- [x] Hammer Curl
- [x] Incline Dumbbell Curl
- [x] Preacher Curl

### Triceps (5)
- [x] Close Grip Bench Press
- [x] Dips (Tricep Focus)
- [x] Overhead Tricep Extension
- [x] Skull Crusher
- [x] Tricep Pushdown

### Quads (6)
- [x] Barbell Back Squat
- [x] Bulgarian Split Squat
- [x] Hack Squat
- [x] Leg Extension
- [x] Leg Press
- [x] Walking Lunges

### Hamstrings (4)
- [x] Good Morning
- [x] Lying Leg Curl
- [x] Romanian Deadlift
- [x] Seated Leg Curl

### Glutes (3)
- [x] Cable Pull Through
- [x] Glute Bridge
- [x] Hip Thrust

### Calves (3)
- [x] Leg Press Calf Raise
- [x] Seated Calf Raise
- [x] Standing Calf Raise

### Abs (4)
- [x] Ab Wheel Rollout
- [x] Cable Crunch
- [x] Hanging Leg Raise
- [x] Plank

---

## Notes

### How to Add a Video for New Exercises
1. Upload the GIF to Supabase Storage under `exercise-demos/`
2. Create a migration to update the exercise:
   ```sql
   UPDATE exercises
   SET demo_gif_url = '/exercise-demos/exercise-name.gif'
   WHERE name = 'Exercise Name';
   ```

### Video Source
Videos are stored as `/exercise-demos/{slugified-name}.gif` paths referencing Supabase Storage.

---

*Last updated: 2025-12-27*

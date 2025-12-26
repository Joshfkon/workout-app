# Missing Exercise Videos Tracker

This document tracks exercises that are missing form demonstration videos/GIFs.

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| **With Videos** | 23 | 47% |
| **Missing Videos** | 26 | 53% |
| **Total Exercises** | 49 | 100% |

## Video Fields

The exercise system uses three optional fields for media:
- `demo_gif_url` - URL to demonstration GIF/animation
- `demo_thumbnail_url` - URL to thumbnail image
- `youtube_video_id` - YouTube video ID for form tutorials

## Exercises Missing Videos

### Chest (1)
- [ ] Machine Chest Press

### Back (1)
- [ ] Chest Supported Row

### Shoulders (2)
- [ ] Dumbbell Shoulder Press
- [ ] Face Pull

### Biceps (3)
- [ ] Cable Curl
- [ ] Incline Dumbbell Curl
- [ ] Preacher Curl

### Triceps (4)
- [ ] Close Grip Bench Press
- [ ] Dips (Tricep Focus)
- [ ] Overhead Tricep Extension
- [ ] Skull Crusher

### Quads (3)
- [ ] Bulgarian Split Squat
- [ ] Hack Squat
- [ ] Walking Lunges

### Hamstrings (2)
- [ ] Good Morning
- [ ] Seated Leg Curl

### Glutes (3)
- [ ] Cable Pull Through
- [ ] Glute Bridge
- [ ] Hip Thrust

### Calves (3)
- [ ] Leg Press Calf Raise
- [ ] Seated Calf Raise
- [ ] Standing Calf Raise

### Abs (4)
- [ ] Ab Wheel Rollout
- [ ] Cable Crunch
- [ ] Hanging Leg Raise
- [ ] Plank

---

## Exercises With Videos (Complete)

### Chest (5)
- [x] Barbell Bench Press
- [x] Cable Fly
- [x] Dips (Chest Focus)
- [x] Dumbbell Bench Press
- [x] Incline Dumbbell Press

### Back (6)
- [x] Barbell Row
- [x] Cable Row
- [x] Deadlift
- [x] Dumbbell Row
- [x] Lat Pulldown
- [x] Pull-Ups

### Shoulders (3)
- [x] Lateral Raise
- [x] Overhead Press
- [x] Rear Delt Fly

### Biceps (3)
- [x] Barbell Curl
- [x] Dumbbell Curl
- [x] Hammer Curl

### Triceps (1)
- [x] Tricep Pushdown

### Quads (3)
- [x] Barbell Back Squat
- [x] Leg Extension
- [x] Leg Press

### Hamstrings (2)
- [x] Lying Leg Curl
- [x] Romanian Deadlift

---

## Notes

### Migration Naming Issues
The following exercises have naming mismatches between the migration and seed data:
- Migration: `"Calf Raise"` → Seed has three separate calf exercises
- Migration: `"Dumbbell Lunges"` → Seed has `"Walking Lunges"`
- Migration: `"Skull Crushers"` → Seed has `"Skull Crusher"`

### Video Source
Videos are sourced from MuscleWiki GIFs stored at `/exercise-demos/{name}.gif` paths in Supabase Storage.

### How to Add a Video
1. Upload the GIF to Supabase Storage under `exercise-demos/`
2. Create a migration to update the exercise:
   ```sql
   UPDATE exercises
   SET demo_gif_url = '/exercise-demos/exercise-name.gif'
   WHERE name = 'Exercise Name';
   ```

---

*Last updated: 2025-12-26*

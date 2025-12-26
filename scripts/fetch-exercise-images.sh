#!/bin/bash
# Fetch exercise images from free-exercise-db
# Source: https://github.com/yuhonas/free-exercise-db (Public Domain)

set -e

OUTPUT_DIR="public/exercise-demos"
mkdir -p "$OUTPUT_DIR"

IMAGE_BASE="https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"

# Download exercise database
echo "📥 Fetching exercise database..."
curl -s "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json" -o /tmp/exercises.json

# Function to download an image
download_image() {
    local our_name="$1"
    local db_name="$2"
    local filename=$(echo "$our_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g').jpg

    # Find the exercise in the JSON and get its first image
    local image_path=$(cat /tmp/exercises.json | \
        python3 -c "import json,sys; data=json.load(sys.stdin); ex=[e for e in data if e['name'].lower()=='$db_name'.lower()]; print(ex[0]['images'][0] if ex and ex[0].get('images') else '')" 2>/dev/null)

    if [ -z "$image_path" ]; then
        echo "⚠️  Not found: $our_name"
        return 1
    fi

    echo "📥 Downloading: $our_name..."
    curl -s "$IMAGE_BASE/$image_path" -o "$OUTPUT_DIR/$filename"
    echo "✅ Saved: $filename"
}

echo ""
echo "Downloading exercise images..."
echo ""

# Chest
download_image "Barbell Bench Press" "barbell bench press - medium grip" || true
download_image "Dumbbell Bench Press" "dumbbell bench press" || true
download_image "Incline Dumbbell Press" "incline dumbbell press" || true
download_image "Cable Fly" "cable crossover" || true
download_image "Dips (Chest Focus)" "dips - chest version" || true

# Back
download_image "Barbell Row" "bent over barbell row" || true
download_image "Dumbbell Row" "one-arm dumbbell row" || true
download_image "Lat Pulldown" "wide-grip lat pulldown" || true
download_image "Pull-Ups" "pullups" || true
download_image "Deadlift" "barbell deadlift" || true
download_image "Cable Row" "seated cable rows" || true

# Shoulders
download_image "Overhead Press" "standing military press" || true
download_image "Lateral Raise" "side lateral raise" || true
download_image "Rear Delt Fly" "seated bent-over rear delt raise" || true

# Legs
download_image "Barbell Back Squat" "barbell squat" || true
download_image "Leg Press" "leg press" || true
download_image "Romanian Deadlift" "romanian deadlift" || true
download_image "Lying Leg Curl" "lying leg curls" || true
download_image "Leg Extension" "leg extensions" || true
download_image "Dumbbell Lunges" "dumbbell lunges" || true
download_image "Calf Raise" "standing calf raises" || true

# Arms
download_image "Barbell Curl" "barbell curl" || true
download_image "Dumbbell Curl" "dumbbell bicep curl" || true
download_image "Hammer Curl" "hammer curls" || true
download_image "Tricep Pushdown" "triceps pushdown" || true
download_image "Skull Crushers" "lying triceps press" || true

echo ""
echo "========== COMPLETE =========="
echo "📁 Images saved to: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*.jpg 2>/dev/null | wc -l | xargs -I{} echo "📊 Total images: {}"

# Generate SQL
echo ""
echo "-- SQL to update database:" > "$OUTPUT_DIR/update-urls.sql"
for f in "$OUTPUT_DIR"/*.jpg; do
    filename=$(basename "$f")
    # Convert filename back to exercise name (rough approximation)
    echo "UPDATE exercises SET demo_gif_url = '/exercise-demos/$filename' WHERE LOWER(REPLACE(name, ' ', '-')) LIKE '%${filename%.jpg}%';" >> "$OUTPUT_DIR/update-urls.sql"
done
echo "📝 SQL file: $OUTPUT_DIR/update-urls.sql"
